export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, COLLECTIONS, toDate } from '@/lib/firestore';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const page = parseInt(sp.get('page') || '1');
  const limit = parseInt(sp.get('limit') || '20');
  const category = sp.get('category');
  const person = sp.get('person');
  const search = sp.get('search');

  const db = getDb();
  let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.KNOWLEDGE)
    .where('is_active', '==', true);

  if (category) query = query.where('category', '==', category);
  if (person) query = query.where('applies_to_person', '==', person);

  const snapshot = await query.get();
  let entries = snapshot.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      key: d.key,
      value: d.value,
      category: d.category || 'general',
      appliesToPerson: d.applies_to_person,
      language: d.language || 'both',
      source: d.source || 'manual',
      isActive: d.is_active,
      updatedAt: toDate(d.updated_at)?.toISOString() || null,
    };
  });

  // Client-side search
  if (search) {
    const s = search.toLowerCase();
    entries = entries.filter(e =>
      (e.key || '').toLowerCase().includes(s) ||
      (e.value || '').toLowerCase().includes(s)
    );
  }

  // Sort by category then key
  entries.sort((a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key));

  const total = entries.length;
  const offset = (page - 1) * limit;
  const paginated = entries.slice(offset, offset + limit);

  return NextResponse.json({
    entries: paginated,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  if (!body.key || !body.value) {
    return NextResponse.json({ error: 'key and value required' }, { status: 400 });
  }

  const db = getDb();
  const ref = await db.collection(COLLECTIONS.KNOWLEDGE).add({
    key: body.key,
    value: body.value,
    category: body.category || 'general',
    language: body.language || 'both',
    applies_to_person: body.appliesToPerson || null,
    source: body.source || 'manual',
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  });

  return NextResponse.json({ id: ref.id, success: true });
}
