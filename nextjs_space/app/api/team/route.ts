export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb, COLLECTIONS, toDate } from '@/lib/firestore';

// GET /api/team — fetch team info, members, approved emails
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getDb();

    // Get current user
    const usersSnap = await db.collection(COLLECTIONS.USERS)
      .where('email', '==', session.user.email)
      .limit(1)
      .get();
    const currentUserDoc = usersSnap.docs[0];
    const currentUser = currentUserDoc ? { id: currentUserDoc.id, ...currentUserDoc.data() } as any : null;
    const teamId = currentUser?.team_id || null;

    // Get team info
    let team = { id: null, name: 'Default Team', slug: 'default', description: null } as any;
    if (teamId) {
      const teamDoc = await db.collection(COLLECTIONS.TEAMS).doc(teamId).get();
      if (teamDoc.exists) {
        team = { id: teamDoc.id, ...teamDoc.data() };
      }
    }

    // Get all members (all users if no team, or team members)
    const membersSnap = await db.collection(COLLECTIONS.USERS).get();
    const members = membersSnap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        name: d.name || null,
        email: d.email || null,
        role: d.role || 'user',
        image: d.image || null,
        createdAt: toDate(d.created_at)?.toISOString() || null,
      };
    });

    // Get approved emails
    const emailsSnap = await db.collection(COLLECTIONS.APPROVED_EMAILS).orderBy('created_at', 'asc').get();
    const approvedEmails = emailsSnap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        email: d.email,
        label: d.label || null,
        addedBy: d.added_by || null,
        createdAt: toDate(d.created_at)?.toISOString() || null,
      };
    });

    return NextResponse.json({
      team,
      members,
      approvedEmails,
      currentUser: { id: currentUser?.id, email: currentUser?.email, role: currentUser?.role || 'admin' },
    });
  } catch (error: any) {
    console.error('Team fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch team data' }, { status: 500 });
  }
}

// PUT /api/team — update team info
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getDb();
    const usersSnap = await db.collection(COLLECTIONS.USERS)
      .where('email', '==', session.user.email)
      .limit(1)
      .get();
    const currentUser = usersSnap.docs[0];
    const userData = currentUser?.data();
    if (userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description } = body;
    const teamId = userData?.team_id;

    if (teamId) {
      await db.collection(COLLECTIONS.TEAMS).doc(teamId).update({
        name,
        description: description || null,
        updated_at: new Date(),
      });
      return NextResponse.json({ team: { id: teamId, name, description } });
    } else {
      // Create team and assign user
      const slug = (name || 'team').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
      const teamRef = await db.collection(COLLECTIONS.TEAMS).add({
        name,
        slug,
        description: description || null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await currentUser.ref.update({ team_id: teamRef.id });
      return NextResponse.json({ team: { id: teamRef.id, name, slug, description } });
    }
  } catch (error: any) {
    console.error('Team update error:', error);
    return NextResponse.json({ error: 'Failed to update team' }, { status: 500 });
  }
}
