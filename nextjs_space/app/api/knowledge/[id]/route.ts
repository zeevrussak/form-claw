export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, COLLECTIONS } from '@/lib/firestore';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const db = getDb();
  const ref = db.collection(COLLECTIONS.KNOWLEDGE).doc(params.id);

  const updates: Record<string, any> = { updated_at: new Date() };
  if ('key' in body) updates.key = body.key;
  if ('value' in body) updates.value = body.value;
  if ('category' in body) updates.category = body.category;
  if ('language' in body) updates.language = body.language;
  if ('appliesToPerson' in body) updates.applies_to_person = body.appliesToPerson;
  if ('source' in body) updates.source = body.source;
  if ('isActive' in body) updates.is_active = body.isActive;

  await ref.update(updates);

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  await db.collection(COLLECTIONS.KNOWLEDGE).doc(params.id).update({
    is_active: false,
    updated_at: new Date(),
  });

  return NextResponse.json({ success: true });
}
