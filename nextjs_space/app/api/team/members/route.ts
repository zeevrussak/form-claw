export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, COLLECTIONS } from '@/lib/firestore';

// PATCH /api/team/members — update a member's role
export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const usersSnap = await db.collection(COLLECTIONS.USERS)
    .where('email', '==', session.user.email)
    .limit(1)
    .get();
  const currentUser = usersSnap.docs[0];
  if (currentUser?.data()?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  try {
    const { userId, role } = await request.json();
    if (!userId || !role || !['admin', 'user', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Invalid userId or role' }, { status: 400 });
    }

    if (userId === currentUser.id && role !== 'admin') {
      return NextResponse.json({ error: 'Cannot remove your own admin role' }, { status: 400 });
    }

    await db.collection(COLLECTIONS.USERS).doc(userId).update({ role });
    const updatedDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const d = updatedDoc.data();

    return NextResponse.json({
      member: { id: updatedDoc.id, name: d?.name, email: d?.email, role: d?.role },
    });
  } catch (error: any) {
    console.error('Member update error:', error);
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
  }
}
