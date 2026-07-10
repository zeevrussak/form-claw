<div align="center">

# 🦞 Form Claw

**Automated Hebrew PDF Form Filler**

Receives forms via email • Analyzes with AI vision • Fills and returns completed PDFs

[![Deploy Processor](https://github.com/zeevrussak/form-claw/actions/workflows/deploy-processor.yml/badge.svg)](https://github.com/zeevrussak/form-claw/actions/workflows/deploy-processor.yml)
[![Deploy Dashboard](https://github.com/zeevrussak/form-claw/actions/workflows/deploy-dashboard.yml/badge.svg)](https://github.com/zeevrussak/form-claw/actions/workflows/deploy-dashboard.yml)
[![Deploy Email Worker](https://github.com/zeevrussak/form-claw/actions/workflows/deploy-email-worker.yml/badge.svg)](https://github.com/zeevrussak/form-claw/actions/workflows/deploy-email-worker.yml)

</div>

---

## Overview

Form Claw is an end-to-end automated system that fills Hebrew PDF forms for the Russak family. Send an email to **formclaw@savlil.com** with a PDF or image attachment, and Form Claw replies with the completed, filled-in form.

### How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FORM CLAW PIPELINE                         │
│                                                                   │
│  📧 Email (PDF/Image)                                             │
│       │                                                           │
│       ▼                                                           │
│  ┌──────────────┐    webhook     ┌──────────────────────┐         │
│  │  Cloudflare   │──────────────▶│   Cloud Run          │         │
│  │  Email Worker │               │   Processor          │         │
│  │  (TypeScript) │               │   (Python/FastAPI)   │         │
│  └──────────────┘               │                      │         │
│                                  │  1. Security scan    │         │
│                                  │  2. PDF → images     │         │
│                                  │  3. Gemini analysis  │         │
│                                  │  4. Code generation  │         │
│                                  │  5. Execute fill     │         │
│                                  │  6. Reply via Resend │         │
│                                  └──────────┬───────────┘         │
│                                             │                     │
│                                  ┌──────────▼───────────┐         │
│                                  │   Google Cloud        │         │
│                                  │   • Firestore (logs)  │         │
│                                  │   • GCS (assets/PDFs) │         │
│                                  └──────────┬───────────┘         │
│                                             │                     │
│  ┌──────────────────────────────────────────▼──────────┐          │
│  │  Dashboard (Next.js on Cloud Run)                   │          │
│  │  • Activity logs • Statistics • System health       │          │
│  │  • Knowledge base • E2E tests • Email intake        │          │
│  │  https://formclaw.savlil.com                        │          │
│  └─────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Email Worker (`/email-worker`)

Cloudflare Worker that receives emails via Cloudflare Email Routing.

| Feature | Detail |
|---------|--------|
| **Runtime** | Cloudflare Workers (TypeScript) |
| **Trigger** | `formclaw@savlil.com` → Cloudflare Email Routing |
| **Accepts** | PDF, JPG, PNG, WEBP, HEIC attachments |
| **Auth** | HMAC webhook secret |
| **Output** | JSON payload to processor `/webhook` |

**Key behaviors:**
- Classifies attachments as PDF, image, or unsupported
- Forwards PDFs and images to the processor for filling
- Sends `intake_drop` event when no processable attachments found
- Extracts email threading headers (`In-Reply-To`, `References`)

### 2. Processor (`/processor`)

Cloud Run service — the brain of Form Claw.

| Feature | Detail |
|---------|--------|
| **Runtime** | Cloud Run (Python 3.11 / FastAPI) |
| **AI Model** | Google Gemini Flash (vision + code generation) |
| **PDF Engine** | ReportLab (overlay) + PyPDF2 (merge) |
| **Image Support** | HEIC via pillow-heif, all standard formats |
| **Reply** | Resend API (formclaw@savlil.com) |

**Processing pipeline:**
1. **Security scan** — Prompt injection detection (Hebrew + English patterns)
2. **Image conversion** — If images received, convert to PDF first
3. **Vision analysis** — Gemini analyzes form fields, coordinates, types
4. **Code generation** — Gemini generates Python fill code with ReportLab
5. **Execution** — Sandboxed execution of generated code
6. **Reply** — Filled PDF sent back to sender via Resend

**Key files:**
| File | Purpose |
|------|--------|
| `main.py` | FastAPI app, webhook handler, LLM orchestration |
| `llm_instructions.py` | Centralized Gemini prompts (analysis + code gen) |
| `form_filler.py` | Code executor with asset path rewriting |
| `security_filter.py` | Prompt injection detection |
| `family_data.json` | Family member data for form filling |

### 3. Dashboard (`/dashboard`)

Monitoring and management interface.

| Feature | Detail |
|---------|--------|
| **Runtime** | Cloud Run (Next.js 14) |
| **Auth** | Google SSO (NextAuth.js) |
| **Database** | Google Cloud Firestore |
| **URL** | https://formclaw.savlil.com |

**Pages:**
- **Dashboard** — Overview stats, recent activity, success rate
- **Activity** — Searchable log of all processed forms
- **Statistics** — Charts for processing trends, response times
- **Errors** — Error logs with CSV export
- **Knowledge** — Manage family data entries for better form filling
- **System** — Health checks, email intake analytics, E2E tests

---

## Infrastructure

| Service | Provider | Purpose |
|---------|----------|---------|
| Email Routing | Cloudflare | Receive emails at formclaw@savlil.com |
| Email Worker | Cloudflare Workers | Parse emails, forward to processor |
| Processor | Google Cloud Run | AI processing and form filling |
| Dashboard | Google Cloud Run | Monitoring UI |
| Database | Google Cloud Firestore | Logs, knowledge, system state |
| File Storage | Google Cloud Storage | Fonts, signatures, filled PDFs |
| DNS | Cloudflare | savlil.com domain management |
| Email Sending | Resend | Reply with filled PDFs |
| AI Model | Google Gemini | Vision analysis + code generation |
| CI/CD | GitHub Actions | Automated deployment + E2E tests |

### GCS Bucket Structure (`formclaw-assets`)

```
formclaw-assets/
├── config/
│   └── family_data.json
├── fonts/
│   ├── FtPilKahol2.ttf    (Hebrew)
│   └── Playzone.ttf        (English)
├── signatures/
│   ├── zeev_signature.png
│   └── keren_signature.png
└── filled/
    └── {log_id}_{filename}.pdf
```

---

## Setup & Development

### Prerequisites

- Python 3.11+
- Node.js 20+
- Google Cloud SDK (`gcloud`)
- Cloudflare account with Wrangler CLI
- Resend account

### Environment Variables

#### Processor
```bash
GEMINI_API_KEY=           # Google AI Studio API key
RESEND_API_KEY=           # Resend API key
WEBHOOK_SECRET=           # Shared secret with email worker
GCS_BUCKET=formclaw-assets
GEMINI_MODEL=gemini-flash-latest
RESEND_FROM="Form Claw Bot <formclaw@savlil.com>"
GOOGLE_APPLICATION_CREDENTIALS=  # GCP service account key
```

#### Email Worker (`wrangler.toml`)
```toml
[vars]
PROCESSOR_URL = "https://formclaw-processor-*.run.app"
WEBHOOK_SECRET = "..."  # Must match processor
```

#### Dashboard
```bash
GOOGLE_APPLICATION_CREDENTIALS=  # GCP service account key (Firestore)
NEXTAUTH_SECRET=                 # NextAuth session secret
GOOGLE_CLIENT_ID=                # Google OAuth client ID
GOOGLE_CLIENT_SECRET=            # Google OAuth client secret
RESEND_API_KEY=                  # For E2E test validation
CLOUDFLARE_API_TOKEN=            # For email intake analytics
CLOUDFLARE_ACCOUNT_ID=           # Cloudflare account
PROCESSOR_URL=                   # Processor base URL
WEBHOOK_SECRET=                  # For E2E test validation
```

### Local Development

```bash
# Processor
cd processor
pip install -r requirements.txt
uvicorn main:app --reload --port 8080

# Dashboard
cd dashboard
yarn install
yarn dev

# Email Worker (local testing)
cd email-worker
npm install
npx wrangler@3.114.17 dev
```

---

## CI/CD

Three deployment workflows in `.github/workflows/`, each triggered by pushes to `main` affecting their respective directory:

| Workflow | Trigger Path | Deploys To |
|----------|-------------|------------|
| `deploy-processor.yml` | `processor/**` | Cloud Run |
| `deploy-dashboard.yml` | `dashboard/**` | Cloud Run |
| `deploy-email-worker.yml` | `email-worker/**` | Cloudflare Workers |

**All workflows include a post-deploy E2E smoke test** (`e2e-test.yml`) that:
1. Checks processor health endpoint
2. Verifies webhook endpoint reachability
3. Reports pass/fail with timestamps

### Required GitHub Secrets

| Secret | Used By |
|--------|---------|
| `WIF_PROVIDER` | Processor, Dashboard (GCP Workload Identity) |
| `GCP_SERVICE_ACCOUNT` | Processor, Dashboard |
| `CLOUDFLARE_API_TOKEN` | Email Worker |
| `PROCESSOR_URL` | E2E tests |
| `WEBHOOK_SECRET` | E2E tests |

---

## API Reference

### Processor

#### `GET /health`
Health check endpoint.

**Response:**
```json
{"status": "ok", "service": "formclaw-processor", "timestamp": "..."}
```

#### `POST /webhook`
Receive email payload from the Email Worker.

**Headers:**
- `Authorization: Bearer {WEBHOOK_SECRET}`
- `Content-Type: application/json`

**Payload (normal form):**
```json
{
  "from": "user@example.com",
  "subject": "Fill for Savyon",
  "text_body": "על ידי קרן בעבור סביון",
  "message_id": "<abc@mail.gmail.com>",
  "in_reply_to": "",
  "references": "",
  "attachments": [
    {
      "filename": "form.pdf",
      "mimeType": "application/pdf",
      "contentBase64": "JVBERi0x..."
    }
  ]
}
```

**Payload (intake drop — no processable attachments):**
```json
{
  "type": "intake_drop",
  "from": "user@example.com",
  "subject": "Hello",
  "reason": "No PDF or image attachments found",
  "attachmentSummary": [{"filename": "notes.txt", "mimeType": "text/plain", "size": 42}]
}
```

**Success response:**
```json
{"status": "success", "id": "log_doc_id", "target": "Savyon", "time": 12.5}
```

### Dashboard API Routes

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/e2e-test` | POST | Session | Run pipeline health checks |
| `/api/intake` | GET | Session | Cloudflare Worker analytics |

---

## LLM Instructions

Gemini prompts are maintained in `processor/llm_instructions.py` as a dedicated module. This separation allows:

- **Version control** — Track prompt changes independently
- **Easy iteration** — Improve prompts without touching processing logic
- **Testing** — Validate prompt templates in isolation

Two main prompts:
1. **Form Analysis** (`FORM_ANALYSIS_SYSTEM` + `build_analysis_prompt`) — Extracts field map from form images
2. **Code Generation** (`CODE_GENERATION_SYSTEM` + `build_code_generation_prompt`) — Generates Python fill code

---

## Security

- **Webhook authentication** — Bearer token between worker and processor
- **Prompt injection detection** — Scans email subject, body, and attachment names for known attack patterns (Hebrew + English)
- **Code sandboxing** — Generated fill code runs in a restricted namespace
- **Email whitelist** — Only authorized senders can use the system
- **Google SSO** — Dashboard access restricted to family Google accounts
- **Asset path rewriting** — Prevents generated code from accessing arbitrary file paths

---

## License

Private project for the Russak family. Not licensed for public use.

---

<div align="center">

Built with 🦞 by the Russak family

</div>
