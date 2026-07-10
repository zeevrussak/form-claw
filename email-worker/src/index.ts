/**
 * Form Claw — Cloudflare Email Worker
 *
 * Receives emails at *@savlil.com via Cloudflare Email Routing,
 * parses MIME, validates sender whitelist, and forwards
 * the parsed email data to the Form Filler Bot webhook.
 *
 * If a whitelisted sender's email can't be processed (no PDFs),
 * it reports the event to the processor for logging + sends an
 * error notification.
 */

import PostalMime from 'postal-mime';

export interface Env {
  WEBHOOK_URL: string;
  WEBHOOK_SECRET: string;
  WHITELISTED_SENDERS: string;
}

/**
 * Detect if an attachment is a PDF — checks MIME type AND filename extension.
 * Outlook/Exchange often send PDFs as application/octet-stream.
 */
function isPdfAttachment(att: { filename?: string; mimeType?: string }): boolean {
  const mime = (att.mimeType || '').toLowerCase();
  const name = (att.filename || '').toLowerCase();
  return (
    mime === 'application/pdf' ||
    name.endsWith('.pdf') ||
    (mime === 'application/octet-stream' && name.endsWith('.pdf'))
  );
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

    // Extract ALL attachments with metadata
    const allAttachments = (parsed.attachments || []).map(att => ({
      filename: att.filename || 'unnamed',
      mimeType: att.mimeType || 'application/octet-stream',
      size: att.content.byteLength,
      isPdf: isPdfAttachment({ filename: att.filename, mimeType: att.mimeType }),
    }));

    for (const a of allAttachments) {
      console.log(`[Form Claw] Attachment: ${a.filename} (${a.mimeType}, ${a.size} bytes, isPdf=${a.isPdf})`);
    }

    // Find PDF attachments
    const pdfIndices = allAttachments
      .map((a, i) => a.isPdf ? i : -1)
      .filter(i => i >= 0);

    const attachmentSummary = allAttachments.map(a => ({
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      isPdf: a.isPdf,
    }));

    if (pdfIndices.length === 0) {
      // No PDFs found — report to processor for logging and error notification
      console.log(`[Form Claw] No PDF attachments found in ${allAttachments.length} total attachments — reporting to processor`);
      console.log(`[Form Claw] Attachment types: ${allAttachments.map(a => `${a.filename}:${a.mimeType}`).join(', ')}`);

      const dropPayload = {
        source: 'cloudflare_email',
        type: 'intake_drop',
        reason: allAttachments.length === 0
          ? 'No attachments found in the email'
          : `No PDF attachments found. Received ${allAttachments.length} attachment(s): ${allAttachments.map(a => `${a.filename} (${a.mimeType})`).join(', ')}`,
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

    // Base64-encode PDFs
    const pdfAttachments = pdfIndices.map(idx => {
      const att = parsed.attachments![idx];
      const meta = allAttachments[idx];
      return {
        filename: meta.filename,
        mimeType: meta.mimeType === 'application/octet-stream' ? 'application/pdf' : meta.mimeType,
        size: meta.size,
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
      attachments: pdfAttachments,
      allAttachmentCount: allAttachments.length,
      attachmentSummary,
      receivedAt: new Date().toISOString(),
    };

    console.log(`[Form Claw] Forwarding ${pdfAttachments.length} PDF(s) to webhook`);

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
