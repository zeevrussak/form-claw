export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createHash } from 'crypto';

/**
 * GET /api/health/check
 * Checks daemon health and sends email alerts if any daemon is stale.
 * Deduplicates alerts — won't re-send if the same issues persist unchanged.
 * Called periodically by a scheduled task or externally.
 * Auth: Bearer HEARTBEAT_TOKEN
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const expectedToken = process.env.HEARTBEAT_TOKEN;

    if (!expectedToken || !authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const systemStatus = await prisma.systemStatus.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (!systemStatus) {
      return NextResponse.json({ healthy: false, message: 'No system status record' });
    }

    const now = Date.now();
    const FORM_PROC_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — form processor is event-driven, only alert if truly stale

    const formAge = systemStatus.lastFormProcessRun ? now - systemStatus.lastFormProcessRun.getTime() : null;
    const formError = systemStatus.formProcessStatus === 'error';

    const alerts: string[] = [];
    if (formError) alerts.push('Form Processor reported ERROR status');
    if (formAge !== null && formAge > FORM_PROC_STALE_MS) alerts.push(`Form Processor hasn\'t run in ${Math.round(formAge / 86400000)}d`);

    if (alerts.length > 0) {
      // Create a fingerprint of the current alert set (ignoring volatile age values)
      const alertFingerprint = createHash('sha256')
        .update([
          formError ? 'form_error' : '',
          (formAge !== null && formAge > FORM_PROC_STALE_MS) ? 'form_stale' : '',
        ].filter(Boolean).sort().join('|'))
        .digest('hex')
        .slice(0, 16);

      const alreadySent = systemStatus.lastAlertHash === alertFingerprint;

      if (!alreadySent) {
        // New or changed alert — send email
        try {
          const appUrl = process.env.NEXTAUTH_URL || 'https://form-claw.abacusai.app';
          const appName = 'Form Claw';

          const htmlBody = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #dc2626; border-bottom: 2px solid #dc2626; padding-bottom: 10px;">
                ⚠️ Daemon Health Alert
              </h2>
              <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
                <p style="margin: 0 0 10px 0; font-weight: bold;">The following issues were detected:</p>
                <ul style="margin: 0; padding-left: 20px;">
                  ${alerts.map(a => `<li style="margin: 5px 0; color: #991b1b;">${a}</li>`).join('')}
                </ul>
              </div>
              <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 5px 0; font-size: 14px;"><strong>Email Source:</strong> ${systemStatus.emailSource ?? 'cloudflare'}</p>
                <p style="margin: 5px 0; font-size: 14px;"><strong>Form Processor:</strong> ${systemStatus.formProcessStatus} | Last: ${systemStatus.lastFormProcessRun?.toISOString() ?? 'Never'}</p>
              </div>
              <p style="color: #666; font-size: 12px;">Check time: ${new Date().toISOString()}</p>
              <p style="margin-top: 15px;"><a href="${appUrl}/system" style="color: #2563eb;">View System Status →</a></p>
            </div>
          `;

          await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deployment_token: process.env.ABACUSAI_API_KEY,
              app_id: process.env.WEB_APP_ID,
              notification_id: process.env.NOTIF_ID_DAEMON_HEALTH_ALERT,
              subject: `⚠️ Form Claw: ${alerts.length} daemon alert(s)`,
              body: htmlBody,
              is_html: true,
              recipient_email: '2396119@gmail.com',
              sender_email: `noreply@${(() => { try { return new URL(appUrl).hostname; } catch { return 'form-claw.abacusai.app'; } })()}`,
              sender_alias: appName,
            }),
          });

          // Record the fingerprint so we don't re-send for the same issue
          await prisma.systemStatus.update({
            where: { id: systemStatus.id },
            data: { lastAlertHash: alertFingerprint, lastAlertSentAt: new Date() },
          });
        } catch (emailErr) {
          console.error('Failed to send daemon alert email:', emailErr);
        }
      }
      // else: same alerts as before, skip email
    } else {
      // Everything healthy — clear the alert hash so a future issue triggers a fresh email
      if (systemStatus.lastAlertHash) {
        await prisma.systemStatus.update({
          where: { id: systemStatus.id },
          data: { lastAlertHash: null, lastAlertSentAt: null },
        });
      }
    }

    return NextResponse.json({
      healthy: alerts.length === 0,
      alerts,
      checkedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Health check error:', error);
    return NextResponse.json({ error: 'Health check failed' }, { status: 500 });
  }
}