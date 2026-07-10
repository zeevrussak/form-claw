export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db, COLLECTIONS } from '@/lib/firestore';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, name } = body ?? {};
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Check if user already exists
    const usersRef = db.collection(COLLECTIONS.USERS);
    const existing = await usersRef.where('email', '==', email).limit(1).get();
    if (!existing.empty) {
      return NextResponse.json({ error: 'User already exists' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userRef = await usersRef.add({
      email,
      password: hashedPassword,
      name: name ?? email?.split('@')?.[0] ?? 'User',
      created_at: new Date(),
      updated_at: new Date(),
    });

    return NextResponse.json({ id: userRef.id, email, name: name ?? email?.split('@')?.[0] ?? 'User' });
  } catch (error: any) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
