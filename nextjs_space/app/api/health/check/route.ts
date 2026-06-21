export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/health/check
 * Checks daemon health and sends email alerts if any daemon is stale.
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
    const WATCH_STALE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

    const watchAge = systemStatus.lastWatchRenewRun ? now - systemStatus.lastWatchRenewRun.getTime() : null;

    const watchStale = watchAge === null || watchAge > WATCH_STALE_MS;
    const watchError = systemStatus.watchRenewStatus === 'error';

    const alerts: string[] = [];
    if (watchStale) alerts.push(`Watch Renewal is STALE (last run: ${watchAge ? Math.round(watchAge / 60000) + 'm ago' : 'never'})`);
    if (watchError) alerts.push('Watch Renewal reported ERROR status');

    if (alerts.length > 0) {
      // Send alert email
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
              <p style="margin: 5px 0; font-size: 14px;"><strong>Watch Status:</strong> ${systemStatus.watchRenewStatus} | Last: ${systemStatus.lastWatchRenewRun?.toISOString() ?? 'Never'}</p>
              <p style="margin: 5px 0; font-size: 14px;"><strong>Form Proc:</strong> ${systemStatus.formProcessStatus} | Last: ${systemStatus.lastFormProcessRun?.toISOString() ?? 'Never'}</p>
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
      } catch (emailErr) {
        console.error('Failed to send daemon alert email:', emailErr);
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
