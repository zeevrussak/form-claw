export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db, COLLECTIONS } from '@/lib/firestore';
import { createHash } from 'crypto';

/**
 * GET /api/health/check
 *
 * Primary health alerter — Firestore version.
 * Reads system_status/current and queries logs collection.
 */

const FAILURE_STATUSES = ['failed', 'failure', 'error'];
const SUCCESS_STATUSES = ['success', 'completed'];
const BLOCKED_STATUSES = ['blocked', 'rejected'];
const SECURITY_HINTS = ['security', 'injection', 'prompt', 'blocked'];

async function validateResendKey(): Promise<{ ok: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: 'RESEND_API_KEY not set' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    let msg = '';
    try { msg = ((await r.json())?.message || '').toLowerCase(); } catch { /* ignore */ }
    if (r.status === 401 || msg.includes('api key is invalid')) {
      return { ok: false, reason: 'Resend API key is invalid' };
    }
    if (r.status === 403) return { ok: false, reason: 'Resend key forbidden (403)' };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: `Resend unreachable: ${e?.message ?? e}` };
  }
}

function toDate(v: any): Date | null {
  if (!v) return null;
  if (v.toDate) return v.toDate(); // Firestore Timestamp
  if (v instanceof Date) return v;
  return new Date(v);
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const expectedToken = process.env.HEARTBEAT_TOKEN;
    if (!expectedToken || !authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const statusDoc = await db.collection(COLLECTIONS.SYSTEM_STATUS).doc('current').get();
    if (!statusDoc.exists) {
      return NextResponse.json({ healthy: false, message: 'No system status record' });
    }
    const ss = statusDoc.data()!;

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const FORM_PROC_STALE_MS = 14 * DAY;
    const CLOUDFLARE_STALE_MS = 14 * DAY;
    const ERROR_RATE_THRESHOLD = 0.5;
    const ERROR_RATE_MIN_VOLUME = 3;

    const alerts: string[] = [];
    const advisories: string[] = [];
    const fpParts: string[] = [];

    // 1+2. Form Processor
    const lastRun = toDate(ss.last_form_process_run || ss.lastFormProcessRun);
    const formAge = lastRun ? now - lastRun.getTime() : null;
    const fpStatus = ss.form_process_status || ss.formProcessStatus || 'unknown';
    if (fpStatus === 'error') {
      alerts.push('Form Processor reported ERROR status');
      fpParts.push('form_error');
    }
    if (formAge !== null && formAge > FORM_PROC_STALE_MS) {
      advisories.push(`Form Processor idle ${Math.round(formAge / DAY)}d`);
    }

    // 3. Webhook intake disabled
    const webhookEnabled = ss.webhook_enabled ?? ss.webhookEnabled ?? true;
    if (!webhookEnabled) {
      alerts.push('Webhook intake is DISABLED — no forms will be processed');
      fpParts.push('webhook_off');
    }

    // 4. Resend outbound validity
    const resend = await validateResendKey();
    if (!resend.ok) {
      alerts.push(`Resend outbound issue: ${resend.reason}`);
      fpParts.push('resend_bad');
    }

    // 5+6. Last 24h logs
    let failureRateInfo: any = null;
    let securityBlockCount = 0;
    try {
      const since = new Date(now - DAY);
      const logsSnap = await db.collection(COLLECTIONS.LOGS)
        .where('created_at', '>=', since)
        .get();

      const recent = logsSnap.docs.map(d => d.data());
      const total = recent.length;
      const failures = recent.filter(r => FAILURE_STATUSES.includes((r.processing_status || '').toLowerCase())).length;
      const successes = recent.filter(r => SUCCESS_STATUSES.includes((r.processing_status || '').toLowerCase())).length;
      failureRateInfo = { total, failures, successes };

      if (total >= ERROR_RATE_MIN_VOLUME && failures / total >= ERROR_RATE_THRESHOLD) {
        alerts.push(`High failure rate: ${failures}/${total} (${Math.round((failures / total) * 100)}%) in 24h`);
        fpParts.push('high_error_rate');
      }

      securityBlockCount = recent.filter(r => {
        const st = (r.processing_status || '').toLowerCase();
        const et = (r.error_type || '').toLowerCase();
        const em = (r.error_message || '').toLowerCase();
        return BLOCKED_STATUSES.includes(st) || SECURITY_HINTS.some(h => et.includes(h) || em.includes(h));
      }).length;
      if (securityBlockCount > 0) {
        alerts.push(`${securityBlockCount} email(s) blocked by the security filter in 24h`);
        fpParts.push(`security_blocks_${securityBlockCount}`);
      }
    } catch (e) {
      console.error('failure-rate/security query failed:', e);
    }

    // 7. Cloudflare intake staleness
    const lastCf = toDate(ss.last_cloudflare_email || ss.lastCloudflareEmail);
    const cfAge = lastCf ? now - lastCf.getTime() : null;
    if (webhookEnabled && cfAge !== null && cfAge > CLOUDFLARE_STALE_MS) {
      advisories.push(`No inbound email via Cloudflare in ${Math.round(cfAge / DAY)}d`);
    }

    // ---- Alerting (deduplicated) ----
    const statusRef = db.collection(COLLECTIONS.SYSTEM_STATUS).doc('current');

    if (alerts.length > 0) {
      const alertFingerprint = createHash('sha256')
        .update(fpParts.filter(Boolean).sort().join('|'))
        .digest('hex')
        .slice(0, 16);

      const alreadySent = (ss.last_alert_hash || ss.lastAlertHash) === alertFingerprint;

      if (!alreadySent) {
        try {
          const appUrl = process.env.NEXTAUTH_URL || 'https://form-claw.abacusai.app';
          const appName = 'Form Claw';
          const htmlBody = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #dc2626; border-bottom: 2px solid #dc2626; padding-bottom: 10px;">
                ⚠️ Form Claw Health Alert
              </h2>
              <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
                <p style="margin: 0 0 10px 0; font-weight: bold;">The following issues were detected:</p>
                <ul style="margin: 0; padding-left: 20px;">
                  ${alerts.map(a => `<li style="margin: 5px 0; color: #991b1b;">${a}</li>`).join('')}
                </ul>
              </div>
              ${advisories.length ? `<div style="background: #fffbeb; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #d97706;">
                <p style="margin: 0 0 8px 0; font-weight: bold; color:#92400e;">Advisories (informational):</p>
                <ul style="margin: 0; padding-left: 20px;">${advisories.map(a => `<li style="margin: 4px 0; color:#92400e;">${a}</li>`).join('')}</ul>
              </div>` : ''}
              <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 5px 0; font-size: 14px;"><strong>Form Processor:</strong> ${fpStatus} | Last run: ${lastRun?.toISOString() ?? 'Never'}</p>
                ${failureRateInfo ? `<p style="margin: 5px 0; font-size: 14px;"><strong>Last 24h:</strong> ${failureRateInfo.total} received, ${failureRateInfo.successes} ok, ${failureRateInfo.failures} failed</p>` : ''}
              </div>
              <p style="color: #666; font-size: 12px;">Check time: ${new Date().toISOString()}</p>
              <p style="margin-top: 15px;"><a href="${appUrl}/system" style="color: #2563eb;">View System Status →</a></p>
            </div>
          `;

          // Use Resend directly in the Google Cloud version
          const resendKey = process.env.RESEND_API_KEY;
          if (resendKey) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: `Form Claw <noreply@savlil.com>`,
                to: ['2396119@gmail.com'],
                subject: `⚠️ Form Claw: ${alerts.length} health alert(s)`,
                html: htmlBody,
              }),
            });
          }

          await statusRef.update({
            last_alert_hash: alertFingerprint,
            last_alert_sent_at: new Date(),
          });
        } catch (emailErr) {
          console.error('Failed to send health alert email:', emailErr);
        }
      }
    } else {
      // Healthy -> clear hash
      if (ss.last_alert_hash || ss.lastAlertHash) {
        await statusRef.update({
          last_alert_hash: null,
          last_alert_sent_at: null,
        });
      }
    }

    return NextResponse.json({
      healthy: alerts.length === 0,
      alerts,
      advisories,
      checks: {
        formProcessStatus: fpStatus,
        webhookEnabled,
        resendOk: resend.ok,
        last24h: failureRateInfo,
        securityBlocks24h: securityBlockCount,
        lastCloudflareEmail: lastCf?.toISOString() ?? null,
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Health check error:', error);
    return NextResponse.json({ error: 'Health check failed' }, { status: 500 });
  }
}
