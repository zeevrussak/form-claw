export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');

    const where = category ? { category } : {};
    const configs = await prisma.appConfig.findMany({ where, orderBy: { key: 'asc' } });

    return NextResponse.json({ configs });
  } catch (error) {
    console.error('Config GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { configs } = body as { configs: { key: string; value: string; label?: string; category?: string }[] };

    if (!configs || !Array.isArray(configs)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const results = await Promise.all(
      configs.map((c) =>
        prisma.appConfig.upsert({
          where: { key: c.key },
          update: { value: c.value, ...(c.label ? { label: c.label } : {}), ...(c.category ? { category: c.category } : {}) },
          create: { key: c.key, value: c.value, label: c.label || c.key, category: c.category || 'general' },
        })
      )
    );

    return NextResponse.json({ configs: results });
  } catch (error) {
    console.error('Config PUT error:', error);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}
