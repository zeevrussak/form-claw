# Form Claw 🦞

**Form Claw — Automated PDF Form-Filling Dashboard**

A monitoring dashboard for the automated PDF form-filling system that processes incoming forms via email.

## Features

- 📊 **Dashboard Overview** - System status, daily stats, success rates
- 📋 **Activity Log** - Searchable, filterable log of all processed forms
- 📈 **Statistics** - Charts and graphs for processing trends
- ❌ **Error Tracking** - Error logs with CSV export
- ⚙️ **System Status** - Gmail webhook status, database health, whitelist

## Authentication

Google SSO with email whitelist - only authorized family members can access.

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Prisma ORM + PostgreSQL
- NextAuth.js (Google SSO)
- Recharts (Data Visualization)
- Tailwind CSS + shadcn/ui

## Architecture

```
Email → Gmail → Pub/Sub Webhook → Form Filler Bot → Database
                                                        ↓
                                              Dashboard (this app)
```

## Environment Variables

```
DATABASE_URL=          # PostgreSQL connection string
NEXTAUTH_SECRET=       # NextAuth session secret
GOOGLE_CLIENT_ID=      # Google OAuth Client ID
GOOGLE_CLIENT_SECRET=  # Google OAuth Client Secret
```

## Development

```bash
yarn install
yarn prisma generate
yarn dev
```

## Deployment

Deployed on Abacus AI platform with automatic deployment.

---

Built with ❤️ by Form Claw
