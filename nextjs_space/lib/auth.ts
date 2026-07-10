import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getDb, COLLECTIONS } from '@/lib/firestore';
import { WHITELISTED_EMAILS } from '@/lib/whitelist';

export const authOptions: NextAuthOptions = {
  // No PrismaAdapter — using JWT-only strategy with Firestore for user lookup
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          prompt: 'select_account',
        },
      },
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }
        try {
          const db = getDb();
          const snapshot = await db.collection(COLLECTIONS.USERS)
            .where('email', '==', credentials.email)
            .limit(1)
            .get();

          if (snapshot.empty) return null;
          const userDoc = snapshot.docs[0];
          const user = userDoc.data();

          if (!user.hashed_password) return null;
          const isValid = await bcrypt.compare(credentials.password, user.hashed_password);
          if (!isValid) return null;

          return {
            id: userDoc.id,
            email: user.email,
            name: user.name,
            role: user.role || 'user',
          };
        } catch (error: any) {
          console.error('Auth error:', error);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  cookies: {
    state: {
      name: 'next-auth.state',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
    pkceCodeVerifier: {
      name: 'next-auth.pkce.code_verifier',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  callbacks: {
    async signIn({ user }) {
      const email = user?.email?.toLowerCase() ?? '';
      if (!WHITELISTED_EMAILS.includes(email)) {
        return '/login?error=AccessDenied';
      }
      // Upsert user in Firestore on Google login
      try {
        const db = getDb();
        const snapshot = await db.collection(COLLECTIONS.USERS)
          .where('email', '==', email)
          .limit(1)
          .get();
        if (snapshot.empty) {
          await db.collection(COLLECTIONS.USERS).add({
            email,
            name: user.name || null,
            role: 'admin',
            created_at: new Date(),
          });
        }
      } catch (e) {
        console.error('Firestore user upsert error:', e);
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any)?.role ?? 'user';
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.id && session?.user) {
        (session.user as any).id = token.id as string;
        (session.user as any).role = token.role as string;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      try {
        if (new URL(url).origin === baseUrl) return url;
      } catch {}
      return baseUrl;
    },
  },
};
