export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, COLLECTIONS } from '@/lib/firestore';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const category = request.nextUrl.searchParams.get('category');
  const db = getDb();
  let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.CONFIG);

  if (category) {
    query = query.where('category', '==', category);
  }

  const snapshot = await query.get();
  const configs = snapshot.docs.map(doc => ({
    id: doc.id,
    key: doc.id, // doc ID is the key
    ...doc.data(),
  }));

  return NextResponse.json(configs);
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { configs } = await request.json();
  const db = getDb();

  const batch = db.batch();
  for (const cfg of configs) {
    const ref = db.collection(COLLECTIONS.CONFIG).doc(cfg.key);
    batch.set(ref, {
      value: cfg.value,
      label: cfg.label || null,
      category: cfg.category || 'general',
      updated_at: new Date(),
    }, { merge: true });
  }
  await batch.commit();

  return NextResponse.json({ success: true });
}
