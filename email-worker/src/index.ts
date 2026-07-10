/**
 * Form Claw — Cloudflare Email Worker
 *
 * Receives emails at *@savlil.com via Cloudflare Email Routing,
 * parses MIME, validates sender whitelist, and forwards
 * the parsed email data to the Form Filler Bot webhook.
 *
 * Setup:
 * 1. Cloudflare Dashboard → Email Routing → enable for savlil.com
 * 2. Add a catch-all or specific route (e.g. formclaw@savlil.com)
 *    pointing to this Worker
 * 3. Deploy: `npx wrangler deploy`
 */

import PostalMime from 'postal-mime';

export interface Env {
  WEBHOOK_URL: string;
  WHITELISTED_SENDERS: string;
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

    // Extract attachments (base64-encode binary ones)
    const attachments = (parsed.attachments || []).map(att => ({
      filename: att.filename || 'unnamed',
      mimeType: att.mimeType || 'application/octet-stream',
      size: att.content.byteLength,
      contentBase64: arrayBufferToBase64(att.content),
    }));

    const pdfAttachments = attachments.filter(
      a => a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')
    );

    if (pdfAttachments.length === 0) {
      console.log(`[Form Claw] No PDF attachments — skipping`);
      // Don't reject — just don't process. The email still gets delivered.
      return;
    }

    // Build webhook payload
    const payload = {
      source: 'cloudflare_email',
      from: from,
      to: to,
      subject: subject,
      messageId: messageId,
      inReplyTo: message.headers.get('in-reply-to') || '',
      references: message.headers.get('references') || '',
      textBody: parsed.text || '',
      htmlBody: parsed.html || '',
      attachments: pdfAttachments,
      allAttachmentCount: attachments.length,
      receivedAt: new Date().toISOString(),
    };

    console.log(`[Form Claw] Forwarding ${pdfAttachments.length} PDF(s) to webhook`);

    // POST to form processor daemon webhook
    try {
      const resp = await fetch(env.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
