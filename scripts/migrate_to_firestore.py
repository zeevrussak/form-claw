#!/usr/bin/env python3
"""
One-time migration: PostgreSQL (Abacus AI) → Google Firestore.

Usage:
  # Set env vars:
  export DATABASE_URL="postgresql://..."
  export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"

  python3 migrate_to_firestore.py
"""

import os
import sys
import json
from datetime import datetime, timezone

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("Install psycopg2: pip install psycopg2-binary")
    sys.exit(1)

try:
    from google.cloud import firestore
except ImportError:
    print("Install google-cloud-firestore: pip install google-cloud-firestore")
    sys.exit(1)


def get_pg_connection():
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: Set DATABASE_URL environment variable")
        sys.exit(1)
    return psycopg2.connect(url)


def migrate_logs(pg, db):
    """Migrate form_processing_logs."""
    print("\n=== Migrating form_processing_logs ===")
    cur = pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM form_processing_logs ORDER BY received_at")
    rows = cur.fetchall()
    print(f"Found {len(rows)} logs")

    batch = db.batch()
    count = 0
    for row in rows:
        doc = {}
        for key, value in row.items():
            if isinstance(value, datetime):
                doc[key] = value
            elif hasattr(value, 'is_finite'):  # Decimal
                doc[key] = float(value)
            elif value is not None:
                doc[key] = value

        ref = db.collection("form_processing_logs").document()
        batch.set(ref, doc)
        count += 1

        if count % 400 == 0:  # Firestore batch limit is 500
            batch.commit()
            print(f"  Committed {count} logs...")
            batch = db.batch()

    batch.commit()
    print(f"  Migrated {count} logs total")
    cur.close()


def migrate_knowledge(pg, db):
    """Migrate knowledge_entries."""
    print("\n=== Migrating knowledge_entries ===")
    cur = pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM knowledge_entries WHERE \"isActive\" = true")
    rows = cur.fetchall()
    print(f"Found {len(rows)} active entries")

    batch = db.batch()
    count = 0
    for row in rows:
        doc = {
            "key": row.get("key"),
            "value": row.get("value"),
            "category": row.get("category", "general"),
            "language": row.get("language", "both"),
            "applies_to_person": row.get("appliesToPerson"),
            "source": row.get("source", "manual"),
            "is_active": True,
            "created_at": row.get("createdAt", datetime.now(timezone.utc)),
            "updated_at": row.get("updatedAt", datetime.now(timezone.utc)),
        }
        ref = db.collection("knowledge_entries").document()
        batch.set(ref, doc)
        count += 1

        if count % 400 == 0:
            batch.commit()
            batch = db.batch()

    batch.commit()
    print(f"  Migrated {count} knowledge entries")
    cur.close()


def migrate_config(pg, db):
    """Migrate app_config."""
    print("\n=== Migrating app_config ===")
    cur = pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT key, value, label, category FROM app_config")
    rows = cur.fetchall()
    print(f"Found {len(rows)} config entries")

    for row in rows:
        db.collection("app_config").document(row["key"]).set({
            "value": row["value"],
            "label": row.get("label"),
            "category": row.get("category", "general"),
            "updated_at": datetime.now(timezone.utc),
        })
    print(f"  Migrated {len(rows)} config entries")
    cur.close()


def migrate_system_status(pg, db):
    """Migrate system_status."""
    print("\n=== Migrating system_status ===")
    cur = pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM system_status LIMIT 1")
    row = cur.fetchone()
    if not row:
        print("  No system_status found, creating default")
        db.collection("system_status").document("current").set({
            "webhook_enabled": True,
            "email_source": "cloudflare",
            "updated_at": datetime.now(timezone.utc),
        })
    else:
        doc = {
            "webhook_enabled": row.get("webhookEnabled", True),
            "email_source": row.get("emailSource", "cloudflare"),
            "last_cloudflare_email": row.get("lastCloudflareEmail"),
            "last_form_process_run": row.get("lastFormProcessRun"),
            "form_process_status": row.get("formProcessStatus", "unknown"),
            "updated_at": datetime.now(timezone.utc),
        }
        db.collection("system_status").document("current").set(doc)
    print("  System status migrated")
    cur.close()


def migrate_users(pg, db):
    """Migrate users."""
    print("\n=== Migrating users ===")
    cur = pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT id, email, name, password, role, "createdAt" FROM "User"')
    rows = cur.fetchall()
    print(f"Found {len(rows)} users")

    for row in rows:
        db.collection("users").document().set({
            "email": row["email"],
            "name": row.get("name"),
            "hashed_password": row.get("password"),
            "role": row.get("role", "user"),
            "created_at": row.get("createdAt", datetime.now(timezone.utc)),
        })
    print(f"  Migrated {len(rows)} users")
    cur.close()


def main():
    print("Form Claw: PostgreSQL → Firestore Migration")
    print("=" * 50)

    pg = get_pg_connection()
    db = firestore.Client()

    try:
        migrate_logs(pg, db)
        migrate_knowledge(pg, db)
        migrate_config(pg, db)
        migrate_system_status(pg, db)
        migrate_users(pg, db)
    finally:
        pg.close()

    print("\n" + "=" * 50)
    print("✅ Migration complete!")
    print("\nVerify in Firebase Console: https://console.firebase.google.com")


if __name__ == "__main__":
    main()
