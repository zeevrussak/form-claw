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
    const person = searchParams.get('person');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    const where: Record<string, unknown> = { isActive: true };
    if (category && category !== 'all') where.category = category;
    if (person && person !== 'all') where.appliesToPerson = person === 'family' ? null : person;
    if (search) {
      where.OR = [
        { key: { contains: search, mode: 'insensitive' as const } },
        { value: { contains: search, mode: 'insensitive' as const } },
      ];
    }

    const [entries, total] = await Promise.all([
      prisma.knowledgeEntry.findMany({
        where: where as any,
        orderBy: [{ category: 'asc' }, { key: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.knowledgeEntry.count({ where: where as any }),
    ]);

    return NextResponse.json({ entries, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Knowledge GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch knowledge entries' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { key, value, category, language, appliesToPerson, source } = body;

    if (!key || !value) {
      return NextResponse.json({ error: 'Key and value are required' }, { status: 400 });
    }

    const entry = await prisma.knowledgeEntry.create({
      data: {
        key,
        value,
        category: category || 'general',
        language: language || 'both',
        appliesToPerson: appliesToPerson || null,
        source: source || 'manual',
      },
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    console.error('Knowledge POST error:', error);
    return NextResponse.json({ error: 'Failed to create knowledge entry' }, { status: 500 });
  }
}
