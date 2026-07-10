// DEPRECATED: This file is kept for backward compatibility.
// The dashboard now uses Firestore via lib/firestore.ts
// Any code importing from here should be migrated to use Firestore.

import { db, COLLECTIONS } from './firestore';

export { db, COLLECTIONS };
