export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, COLLECTIONS } from '@/lib/firestore';

const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const WORKER_NAME = 'form-claw-email';

/**
 * GET /api/intake
 *
 * Returns recent email intake events from two sources:
 *  1. Cloudflare Worker analytics (invocations, errors)
 *  2. Firestore processing logs (shows what actually got processed)
 *
 * This gives visibility into emails that arrived but were
 * silently dropped (no PDF, not whitelisted, worker error).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result: Record<string, any> = {
    workerStats: null,
    recentProcessed: [],
    workerError: null,
  };

  // 1. Cloudflare Worker analytics
  if (CF_API_TOKEN && CF_ACCOUNT_ID) {
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const query = `{
        viewer {
          accounts(filter: {accountTag: "${CF_ACCOUNT_ID}"}) {
            workersInvocationsAdaptive(
              limit: 50,
              filter: {scriptName: "${WORKER_NAME}", datetime_gt: "${since}"},
              orderBy: [datetime_DESC]
            ) {
              sum { requests subrequests errors }
              dimensions { scriptName status datetime }
            }
          }
        }
      }`;

      const resp = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(10000),
      });

      if (resp.ok) {
        const data = await resp.json();
        const invocations = data?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];

        // Aggregate stats
        let totalInvocations = 0;
        let totalErrors = 0;
        let totalSubrequests = 0;
        const events: any[] = [];

        for (const inv of invocations) {
          totalInvocations += inv.sum.requests;
          totalErrors += inv.sum.errors;
          totalSubrequests += inv.sum.subrequests;
          events.push({
            datetime: inv.dimensions.datetime,
            status: inv.dimensions.status,
            requests: inv.sum.requests,
            subrequests: inv.sum.subrequests,
            errors: inv.sum.errors,
            // Interpret: subrequests > 0 means webhook was called (PDF forwarded)
            forwarded: inv.sum.subrequests > 0,
          });
        }

        result.workerStats = {
          period: '7d',
          totalInvocations,
          totalErrors,
          totalSubrequests,
          // Invocations with 0 subrequests = dropped (no PDF or not whitelisted)
          totalDropped: events.filter(e => !e.forwarded && e.status === 'success').reduce((s, e) => s + e.requests, 0),
          totalExceptions: events.filter(e => e.status === 'scriptThrewException').reduce((s, e) => s + e.requests, 0),
          events: events.slice(0, 30), // Last 30 events
        };
      } else {
        const errBody = await resp.text();
        result.workerError = `Cloudflare API error: HTTP ${resp.status}`;
      }
    } catch (e: any) {
      result.workerError = `Cloudflare API error: ${e?.message}`;
    }
  } else {
    result.workerError = 'Cloudflare API credentials not configured (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)';
  }

  // 2. Recent processing logs from Firestore
  try {
    const db = getDb();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const logsSnap = await db.collection(COLLECTIONS.LOGS)
      .orderBy('received_at', 'desc')
      .limit(20)
      .get();

    result.recentProcessed = logsSnap.docs.map(d => {
      const data = d.data();
      const receivedAt = data.received_at?.toDate?.()?.toISOString?.() || data.received_at;
      return {
        id: d.id,
        sender: data.sender_email,
        subject: data.subject,
        status: data.processing_status,
        errorType: data.error_type || null,
        errorMessage: data.error_message?.substring(0, 200) || null,
        target: data.target_person || null,
        processingTime: data.processing_time_seconds || null,
        receivedAt,
      };
    });
  } catch (e: any) {
    result.recentProcessed = [];
  }

  return NextResponse.json(result);
}
