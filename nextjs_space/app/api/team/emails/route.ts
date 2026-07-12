export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, COLLECTIONS } from '@/lib/firestore';

// POST /api/team/emails — add approved email
export async function POST(request: NextRequest) {
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
    const { email, label } = await request.json();
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check for duplicates
    const existing = await db.collection(COLLECTIONS.APPROVED_EMAILS)
      .where('email', '==', cleanEmail)
      .limit(1)
      .get();
    if (!existing.empty) {
      return NextResponse.json({ error: 'Email already approved' }, { status: 409 });
    }

    const ref = await db.collection(COLLECTIONS.APPROVED_EMAILS).add({
      email: cleanEmail,
      label: label || null,
      team_id: currentUser.data()?.team_id || null,
      added_by: session.user.email,
      created_at: new Date(),
    });

    return NextResponse.json({
      entry: { id: ref.id, email: cleanEmail, label: label || null },
    });
  } catch (error: any) {
    console.error('Add email error:', error);
    return NextResponse.json({ error: 'Failed to add email' }, { status: 500 });
  }
}

// DELETE /api/team/emails — remove approved email
export async function DELETE(request: NextRequest) {
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
    const { emailId } = await request.json();
    await db.collection(COLLECTIONS.APPROVED_EMAILS).doc(emailId).delete();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Remove email error:', error);
    return NextResponse.json({ error: 'Failed to remove email' }, { status: 500 });
  }
}
