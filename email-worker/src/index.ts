/**
 * Form Claw — Cloudflare Email Worker
 *
 * Receives emails at *@savlil.com via Cloudflare Email Routing,
 * parses MIME, validates sender whitelist, and forwards
 * the parsed email data to the Form Filler Bot webhook.
 *
 * Supports PDF and image (jpg, png, jpeg, webp, heic) attachments.
 * If a whitelisted sender's email has no supported attachments,
 * it reports the event for logging and sends an error reply.
 */

import PostalMime from 'postal-mime';

export interface Env {
  WEBHOOK_URL: string;
  WEBHOOK_SECRET: string;
  WHITELISTED_SENDERS: string;
}

const PDF_EXTENSIONS = ['.pdf'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic'];
const IMAGE_MIME_PREFIXES = ['image/'];
const PDF_MIMES = ['application/pdf'];

/**
 * Classify an attachment as 'pdf', 'image', or 'other'.
 */
function classifyAttachment(att: { filename?: string; mimeType?: string }): 'pdf' | 'image' | 'other' {
  const mime = (att.mimeType || '').toLowerCase();
  const name = (att.filename || '').toLowerCase();

  // PDF check
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  // Also catch octet-stream PDFs
  if (mime === 'application/octet-stream' && name.endsWith('.pdf')) return 'pdf';

  // Image check by MIME
  if (IMAGE_MIME_PREFIXES.some(p => mime.startsWith(p))) return 'image';
  // Image check by extension (some clients send as octet-stream)
  if (IMAGE_EXTENSIONS.some(ext => name.endsWith(ext))) return 'image';

  return 'other';
}

function buildHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.WEBHOOK_SECRET) {
    headers['Authorization'] = `Bearer ${env.WEBHOOK_SECRET}`;
  }
  return headers;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    const from = message.from.toLowerCase();
    const to = message.to.toLowerCase();
    const subject = message.headers.get('subject') || '(no subject)';
    const messageId = message.headers.get('message-id') || '';

    console.log(`[Form Claw] Incoming email from=${from} to=${to} subject="${subject}"`);

    // Whitelist check
    const whitelist = env.WHITELISTED_SENDERS
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    if (!whitelist.includes(from)) {
      console.log(`[Form Claw] Sender ${from} not whitelisted — rejecting`);
      message.setReject('Sender not authorized');
      return;
    }

    // Read raw email bytes
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const rawUint8 = new Uint8Array(rawEmail);

    // Parse MIME
    const parser = new PostalMime();
    const parsed = await parser.parse(rawUint8);

    // Classify ALL attachments
    const allAttachments = (parsed.attachments || []).map(att => {
      const kind = classifyAttachment({ filename: att.filename, mimeType: att.mimeType });
      const meta = {
        filename: att.filename || 'unnamed',
        mimeType: att.mimeType || 'application/octet-stream',
        size: att.content.byteLength,
        kind,
      };
      console.log(`[Form Claw] Attachment: ${meta.filename} (${meta.mimeType}, ${meta.size} bytes, kind=${kind})`);
      return meta;
    });

    // Separate PDFs and images
    const pdfIndices = allAttachments.map((a, i) => a.kind === 'pdf' ? i : -1).filter(i => i >= 0);
    const imageIndices = allAttachments.map((a, i) => a.kind === 'image' ? i : -1).filter(i => i >= 0);

    const hasSupportedAttachments = pdfIndices.length > 0 || imageIndices.length > 0;

    const attachmentSummary = allAttachments.map(a => ({
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      kind: a.kind,
    }));

    if (!hasSupportedAttachments) {
      // No processable attachments — report drop
      console.log(`[Form Claw] No PDF or image attachments found in ${allAttachments.length} total — reporting to processor`);

      const dropPayload = {
        source: 'cloudflare_email',
        type: 'intake_drop',
        reason: allAttachments.length === 0
          ? 'No attachments found in the email'
          : `No supported attachments found. Accepted types: PDF, JPG, PNG, WEBP, HEIC. Received ${allAttachments.length} attachment(s): ${allAttachments.map(a => `${a.filename} (${a.mimeType})`).join(', ')}`,
        from,
        to,
        subject,
        messageId,
        inReplyTo: message.headers.get('in-reply-to') || '',
        references: message.headers.get('references') || '',
        attachmentSummary,
        receivedAt: new Date().toISOString(),
      };

      try {
        const resp = await fetch(env.WEBHOOK_URL, {
          method: 'POST',
          headers: buildHeaders(env),
          body: JSON.stringify(dropPayload),
        });
        console.log(`[Form Claw] Drop report response: ${resp.status}`);
      } catch (err) {
        console.error(`[Form Claw] Drop report failed:`, err);
      }
      return;
    }

    // Base64-encode supported attachments
    const supportedAttachments = [...pdfIndices, ...imageIndices].map(idx => {
      const att = parsed.attachments![idx];
      const meta = allAttachments[idx];
      // Normalize PDF MIME type
      let mimeType = meta.mimeType;
      if (meta.kind === 'pdf' && mimeType === 'application/octet-stream') {
        mimeType = 'application/pdf';
      }
      return {
        filename: meta.filename,
        mimeType,
        size: meta.size,
        kind: meta.kind,
        contentBase64: arrayBufferToBase64(att.content),
      };
    });

    // Build webhook payload
    const payload = {
      source: 'cloudflare_email',
      from,
      to,
      subject,
      messageId,
      inReplyTo: message.headers.get('in-reply-to') || '',
      references: message.headers.get('references') || '',
      textBody: parsed.text || '',
      htmlBody: parsed.html || '',
      attachments: supportedAttachments,
      allAttachmentCount: allAttachments.length,
      attachmentSummary,
      receivedAt: new Date().toISOString(),
    };

    console.log(`[Form Claw] Forwarding ${pdfIndices.length} PDF(s) + ${imageIndices.length} image(s) to webhook`);

    try {
      const resp = await fetch(env.WEBHOOK_URL, {
        method: 'POST',
        headers: buildHeaders(env),
        body: JSON.stringify(payload),
      });

      console.log(`[Form Claw] Webhook response: ${resp.status}`);

      if (!resp.ok) {
        const body = await resp.text();
        console.error(`[Form Claw] Webhook error: ${body}`);
      }
    } catch (err) {
      console.error(`[Form Claw] Webhook call failed:`, err);
    }
  },
} satisfies ExportedHandler<Env>;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
