# Software Requirements Specification (SRS)
## Form Claw — Automated PDF Form-Filling System

<<<<<<< HEAD
**Version:** 1.1  
=======
**Version:** 1.2  
>>>>>>> 72c35ee (v1.2: Add polling/webhook toggles, security filter, update docs)
**Date:** June 4, 2026  
**Author:** Russak Family Automation Project  

---

## 1. Introduction

### 1.1 Purpose
Form Claw is an automated system that monitors a Gmail inbox, receives PDF/DOC/image form attachments, intelligently fills them with family member data, and replies with the completed form — all without manual intervention.

### 1.2 Scope
The system consists of three major components:
1. **Email Processing Pipeline** — daemon tasks that poll Gmail, normalize attachments, and fill forms using LLM + PDF manipulation
2. **Monitoring Dashboard** — a web application for viewing activity logs, statistics, errors, knowledge base, and system health
3. **Knowledge Store** — a persistent, editable database of family information used by the bot to fill forms, with auto-curation from interactions

### 1.3 Target Users
- Russak family members (Ze'ev, Keren) who forward forms via email
- The system itself (autonomous processing)

---

## 2. System Overview

### 2.1 High-Level Architecture
```
[Email Sender] → [Gmail: russakbot@gmail.com] → [Google Pub/Sub Webhook]
       ↓
[Polling Bridge Daemon] → [Form Processing Daemon (event-based)]
       ↓
[Normalize Attachment] → [OCR if image] → [LLM Analysis & Fill]
       ↓
[Reply with filled PDF] → [Log to Database]
       ↓
[Dashboard reads DB] ← [User views dashboard]
```

### 2.2 Email Flow
1. Family members forward forms to `formfill@20032014.xyz` (alias for `russakbot@gmail.com`)
2. Google Pub/Sub notifies the system of new messages
3. A polling bridge daemon picks up new messages and triggers the processing daemon via webhook
4. The processing daemon fills the form and replies in the same email thread

---

## 3. Functional Requirements

### 3.1 Email Monitoring (FR-01)
- **FR-01.1:** System SHALL monitor `russakbot@gmail.com` for new incoming emails
- **FR-01.2:** System SHALL use Google Cloud Pub/Sub (project: `form-claw`, topic: `gmail-formbot`) for real-time notifications
- **FR-01.3:** A separate daemon SHALL renew the Gmail watch subscription every 6 days before expiration
- **FR-01.4:** System SHALL only process emails from whitelisted senders:
  - `k6622024@gmail.com` (Keren)
  - `2396119@gmail.com` (Ze'ev)
  - `zeev@infiniplex.life` (Ze'ev alternate)
  - `targetmailbox@gmail.com` (testing)
- **FR-01.5:** System SHALL mark processed emails as READ immediately after extracting attachments

### 3.2 Attachment Normalization (FR-02)
- **FR-02.1:** PDF files SHALL be processed directly
- **FR-02.2:** DOC/DOCX files SHALL be converted to PDF using LibreOffice headless mode
- **FR-02.3:** Image files (PNG, JPG, JPEG) SHALL be merged into a single multi-page PDF using `img2pdf`
- **FR-02.4:** Image-based PDFs SHALL go through an OCR pipeline before processing
- **FR-02.5:** Multi-page forms SHALL be supported (all pages filled)

### 3.3 Form Filling (FR-03)
- **FR-03.1:** System SHALL use LLM (via Abacus.AI RouteLLM API) to analyze form structure and determine field locations
- **FR-03.2:** System SHALL read family data from the Knowledge Store (database) to populate fields
- **FR-03.3:** System SHALL use configurable fonts:
  - English fields: configurable (default: "Playzone", file: `Playzone.ttf`)
  - Hebrew fields: configurable (default: "פיל כחול", file: `FtPilKahol2.ttf`)
- **FR-03.4:** Font names SHALL be configurable from the dashboard Settings page
- **FR-03.5:** System SHALL place the correct signature (Ze'ev or Keren) based on the detected signer
- **FR-03.6:** For fields with OR/slash options, system SHALL mark the correct choice with an ellipse
- **FR-03.7:** Filled text SHALL NOT overflow onto existing form text or lines

### 3.4 Instruction Parsing (FR-04)
- **FR-04.1:** System SHALL parse email subject and body for instructions in Hebrew and English
- **FR-04.2:** Instructions SHALL override auto-detection for:
  - Target child (e.g., "עבור סביון" → Savyon, "For Clil" → Clil)
  - Signer (e.g., "על ידי קרן" → Keren signs, "by Ze'ev" → Ze'ev signs)
- **FR-04.3:** System SHALL support keyword detection for both parents and both children
- **FR-04.4:** If no explicit instruction, system SHALL attempt auto-detection from form content

### 3.5 Reply Mechanism (FR-05)
- **FR-05.1:** System SHALL reply in the same email thread with the filled PDF attached
- **FR-05.2:** Reply body SHALL be plain text (not HTML to avoid .htm attachment issues)
- **FR-05.3:** Reply SHALL include a brief summary of what was filled

### 3.6 Knowledge Curation (FR-06)
- **FR-06.1:** System SHALL maintain a persistent knowledge store in the database (`knowledge_entries` table)
- **FR-06.2:** Knowledge entries SHALL have: key, value, category, language, appliesToPerson, source, isActive
- **FR-06.3:** Categories SHALL include: personal, address, medical, school, contact, preference, general
- **FR-06.4:** When the bot asks for clarification and receives new information, it SHALL auto-curate this into the knowledge store
- **FR-06.5:** Auto-curated entries SHALL be marked with source indicating the email/interaction they came from
- **FR-06.6:** Knowledge entries SHALL be viewable and editable from the dashboard

### 3.7 Dashboard (FR-07)
- **FR-07.1:** Dashboard SHALL require authentication (Google SSO with email whitelist)
- **FR-07.2:** Dashboard SHALL display:
  - **Overview:** system status cards, today's stats, quick metrics
  - **Activity Log:** paginated, filterable table of all form processing events
  - **Statistics:** charts (daily trends, status distribution, processing time, sender/target breakdown)
  - **Error Log:** filterable error list with CSV export
  - **Knowledge Base:** searchable, filterable, editable knowledge entries
  - **System Status:** Gmail watch status, DB health, whitelist
  - **Settings:** configurable fonts and other options

### 3.8 Configuration (FR-08)
- **FR-08.1:** App-wide configuration SHALL be stored in `app_config` table (key-value with category)
- **FR-08.2:** Font configuration SHALL be editable from the Settings page
- **FR-08.3:** Changes SHALL take effect on the next form processed

<<<<<<< HEAD
=======
### 3.9 Intake Channel Control (FR-09)
- **FR-09.1:** System SHALL support toggling the Webhook (Pub/Sub) intake channel on/off from the System Status page
- **FR-09.2:** System SHALL support toggling the Polling Bridge intake channel on/off from the System Status page
- **FR-09.3:** Webhook SHALL default to enabled; Polling SHALL default to disabled
- **FR-09.4:** Toggle state SHALL be persisted in `system_status` table (`webhookEnabled`, `pollingEnabled` columns)
- **FR-09.5:** Daemons SHOULD check these flags before processing (graceful skip if their channel is disabled)

### 3.10 Prompt Injection Security (FR-10)
- **FR-10.1:** System SHALL scan all incoming email content (subject, body, attachment text) for prompt injection patterns before LLM processing
- **FR-10.2:** Security filter SHALL detect injection patterns in both English and Hebrew
- **FR-10.3:** Detection categories SHALL include: instruction override, role hijacking, data exfiltration, encoded payloads, form-fill manipulation, signature forgery
- **FR-10.4:** Emails scoring above the risk threshold (≥ 0.70) SHALL be blocked and logged with a security flag
- **FR-10.5:** Security filter script located at `/home/ubuntu/shared/security_filter.py`

>>>>>>> 72c35ee (v1.2: Add polling/webhook toggles, security filter, update docs)
---

## 4. Non-Functional Requirements

### 4.1 Security (NFR-01)
- Dashboard access restricted to whitelisted email addresses via Google SSO
- All API routes protected by session authentication
- Middleware enforces whitelist on all protected routes
- Gmail credentials stored securely in Abacus AI Agent secrets
<<<<<<< HEAD
=======
- Prompt injection security filter scans all email content before LLM processing
- Bilingual pattern detection (English + Hebrew) with risk scoring
>>>>>>> 72c35ee (v1.2: Add polling/webhook toggles, security filter, update docs)

### 4.2 Reliability (NFR-02)
- Gmail watch subscription auto-renewed every 6 days
- All processing events logged to database regardless of outcome
- Error logging with type categorization for debugging
- System health monitoring with database connectivity checks

### 4.3 Performance (NFR-03)
- Form processing target: < 60 seconds per form
- Dashboard page loads: < 3 seconds
- Database queries optimized with indexes on frequently queried columns

### 4.4 Maintainability (NFR-04)
- Knowledge store editable without code changes
- Font configuration changeable from UI
- Modular daemon architecture (separate watch renewal + processing tasks)

---

## 5. External Integrations

| Service | Purpose | Credentials |
|---------|---------|-------------|
| Gmail API | Read emails, send replies, manage watch | OAuth2 (gmailuser) |
| Google Cloud Pub/Sub | Real-time email notifications | Project: form-claw, Topic: gmail-formbot |
| Abacus.AI RouteLLM | Form analysis, field mapping, OCR processing | ABACUSAI_API_KEY |
| Google OAuth | Dashboard SSO authentication | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET |
| PostgreSQL | Data persistence | DATABASE_URL |
| LibreOffice | DOC→PDF conversion | System binary (headless) |
| img2pdf | Image→PDF merging | Python package |

---

## 6. Data Assets

### 6.1 Family Data
Stored in Knowledge Store (database) and `/home/ubuntu/shared/family_data.json` (legacy):
- Family members: Ze'ev (father), Keren (mother), Savyon (daughter), Clil (daughter)
- IDs, birth dates, addresses, phone numbers, emails
- School information, medical diagnoses (ASD since 2016)
- Instruction parsing keywords (Hebrew + English)

### 6.2 Signature Assets
- `zr signature nxp.png` — Ze'ev's signature
- `keren sig.png` — Keren's signature
- Stored in `/home/ubuntu/shared/` and `/home/ubuntu/Shared/Uploads/`

### 6.3 Font Assets
- `Playzone.ttf` — English form-filling font
- `FtPilKahol2.ttf` — Hebrew form-filling font (פיל כחול)
- Stored in `/home/ubuntu/shared/fonts/` and `public/fonts/`

---

## 7. User Stories

| ID | As a... | I want to... | So that... |
|----|---------|-------------|------------|
| US-01 | Parent | Forward a school form to formfill@20032014.xyz | The form is automatically filled and returned |
| US-02 | Parent | Specify "for Savyon by Keren" in email subject | The correct child and signer are used |
| US-03 | Parent | View processing history on dashboard | I can track which forms were processed |
| US-04 | Parent | See error details when processing fails | I can understand and resolve issues |
| US-05 | Parent | Edit knowledge entries on dashboard | I can correct or add family information |
| US-06 | Parent | Change the form-filling font | Different fonts can be used for different needs |
| US-07 | System | Auto-learn from clarification emails | Knowledge base grows over time without manual entry |
| US-08 | Parent | Export error logs as CSV | I can analyze issues offline |

---

## 8. Acceptance Criteria

1. Email with PDF attachment → filled PDF reply within 60 seconds
2. Email with DOC attachment → converted to PDF, filled, replied
3. Email with multiple images → merged into PDF, OCR'd, filled, replied
4. Email with Hebrew instructions → correct child/signer override
5. Dashboard shows real-time processing logs after each form
6. Knowledge base seeded with all family data, editable inline
7. Font configuration saved and persisted across sessions
8. Only whitelisted emails can access dashboard and trigger processing
9. Gmail watch stays active (auto-renewed every 6 days)
10. All errors logged with categorization and exportable
