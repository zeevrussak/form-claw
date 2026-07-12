/**
 * Firestore client for the Form Claw dashboard.
 * Replaces Prisma for the Google Cloud Run deployment.
 */

import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore, Timestamp, FieldPath } from 'firebase-admin/firestore';

let app: App;
let _db: Firestore;

function getApp(): App {
  if (getApps().length === 0) {
    // In Cloud Run, Application Default Credentials are auto-available
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const serviceAccount = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
      app = initializeApp({ credential: cert(serviceAccount) });
    } else {
      app = initializeApp();
    }
  }
  return getApps()[0];
}

export function getDb(): Firestore {
  if (!_db) {
    getApp();
    _db = getFirestore();
  }
  return _db;
}

// Lazy proxy so files importing `db` get a working Firestore instance
export const db: Firestore = new Proxy({} as Firestore, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
});

// Collection names
export const COLLECTIONS = {
  LOGS: 'form_processing_logs',
  KNOWLEDGE: 'knowledge_entries',
  CONFIG: 'app_config',
  SYSTEM: 'system_status',
  USERS: 'users',
  TEAMS: 'teams',
  APPROVED_EMAILS: 'approved_emails',
} as const;

// Helper to convert Firestore Timestamp to Date
export function toDate(ts: any): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts === 'string') return new Date(ts);
  if (ts.toDate) return ts.toDate();
  return null;
}

// Helper to convert Firestore doc to a plain object with id
export function docToObj(doc: FirebaseFirestore.DocumentSnapshot): Record<string, any> | null {
  if (!doc.exists) return null;
  const data = doc.data()!;
  return { id: doc.id, ...data };
}

export { Timestamp };
