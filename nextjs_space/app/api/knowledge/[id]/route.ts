export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { key, value, category, language, appliesToPerson, source, isActive } = body;

    const entry = await prisma.knowledgeEntry.update({
      where: { id: params.id },
      data: {
        ...(key !== undefined ? { key } : {}),
        ...(value !== undefined ? { value } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(language !== undefined ? { language } : {}),
        ...(appliesToPerson !== undefined ? { appliesToPerson } : {}),
        ...(source !== undefined ? { source } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    return NextResponse.json({ entry });
  } catch (error) {
    console.error('Knowledge PUT error:', error);
    return NextResponse.json({ error: 'Failed to update knowledge entry' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await prisma.knowledgeEntry.update({
      where: { id: params.id },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Knowledge DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete knowledge entry' }, { status: 500 });
  }
}
