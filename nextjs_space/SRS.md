# Form Claw — Software Requirements Specification (SRS)

**Version:** 2.0  
**Date:** July 2026  
**Project:** Form Claw — Automated Hebrew PDF Form Filler  

---

## 1. Introduction

### 1.1 Purpose

Form Claw automates the process of filling Hebrew PDF forms for the Russak family. Users send a form via email and receive the completed form as a reply, eliminating manual data entry.

### 1.2 Scope

The system encompasses:
- Email reception and attachment processing
- AI-powered form analysis (field detection, coordinate mapping)
- Automated form filling (text, signatures, checkboxes, ID digits)
- Reply delivery with the filled PDF
- Monitoring dashboard with analytics and health checks

### 1.3 Definitions

| Term | Definition |
|------|------------|
| Form Claw | The complete automated form-filling system |
| Processor | The Cloud Run service that performs AI analysis and form filling |
| Email Worker | The Cloudflare Worker that receives and routes emails |
| Knowledge Base | Family-specific data entries stored in Firestore |
| Intake Drop | An email received but not processed (no valid attachments) |

---

## 2. Overall Description

### 2.1 System Context

Form Claw operates as an email-driven automation pipeline:

1. Family members send emails with PDF or image attachments to `formclaw@savlil.com`
2. The system identifies the target person and signer from email context
3. AI vision analyzes form structure and generates filling code
4. The filled PDF is sent back as an email reply

### 2.2 User Classes

| User | Description | Access |
|------|-------------|--------|
| Family member | Sends forms for filling | Email (whitelisted) |
| Admin | Monitors system, manages knowledge | Dashboard (Google SSO) |

### 2.3 Operating Environment

| Component | Environment |
|-----------|-------------|
| Email reception | Cloudflare Email Routing |
| Email processing | Cloudflare Workers (V8 isolate) |
| Form processing | Google Cloud Run (container) |
| Dashboard | Google Cloud Run (container) |
| Data storage | Google Cloud Firestore |
| File storage | Google Cloud Storage |
| Email sending | Resend API |
| AI model | Google Gemini Flash |

---

## 3. Functional Requirements

### 3.1 Email Reception (FR-100)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-101 | System SHALL receive emails at formclaw@savlil.com | Must |
| FR-102 | System SHALL accept PDF attachments (application/pdf) | Must |
| FR-103 | System SHALL accept image attachments (JPG, PNG, WEBP, HEIC) | Must |
| FR-104 | System SHALL convert image attachments to PDF before processing | Must |
| FR-105 | System SHALL reply with an error when no valid attachments are found | Must |
| FR-106 | System SHALL extract email threading headers for proper reply threading | Should |
| FR-107 | System SHALL classify attachments by MIME type and file extension | Must |

### 3.2 Form Analysis (FR-200)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-201 | System SHALL convert PDF pages to images for AI analysis | Must |
| FR-202 | System SHALL identify all fillable fields with coordinates | Must |
| FR-203 | System SHALL detect field types: text, date, checkbox, radio, signature, ID digits | Must |
| FR-204 | System SHALL identify OR/slash selection constructs (כן/לא, אב/אם) | Must |
| FR-205 | System SHALL determine the target person from email context | Must |
| FR-206 | System SHALL determine the signer (parent) from email context | Should |
| FR-207 | System SHALL identify the form's purpose and issuing body | Should |

### 3.3 Form Filling (FR-300)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-301 | System SHALL generate Python code using ReportLab for PDF overlay | Must |
| FR-302 | System SHALL handle Hebrew RTL text with character reversal | Must |
| FR-303 | System SHALL fill ID number digit boxes individually | Must |
| FR-304 | System SHALL draw ellipses around selected options (OR/slash) | Must |
| FR-305 | System SHALL overlay signature PNG images with transparency | Must |
| FR-306 | System SHALL prevent text overflow beyond field boundaries | Must |
| FR-307 | System SHALL use family data and knowledge base entries | Must |
| FR-308 | System SHALL merge overlay with original PDF without quality loss | Must |
| FR-309 | System SHALL support multi-page forms | Must |

### 3.4 Reply Delivery (FR-400)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-401 | System SHALL reply to the sender with the filled PDF attached | Must |
| FR-402 | System SHALL thread the reply to the original email | Should |
| FR-403 | System SHALL send error notifications on processing failure | Must |
| FR-404 | System SHALL send explanatory replies for intake drops | Must |

### 3.5 Security (FR-500)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-501 | System SHALL authenticate webhook requests with bearer token | Must |
| FR-502 | System SHALL scan email content for prompt injection attacks | Must |
| FR-503 | System SHALL detect Hebrew and English injection patterns | Must |
| FR-504 | System SHALL block emails exceeding risk score threshold | Must |
| FR-505 | System SHALL execute generated code in a restricted namespace | Must |
| FR-506 | System SHALL rewrite file paths in generated code to safe locations | Must |

### 3.6 Dashboard (FR-600)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-601 | Dashboard SHALL require Google SSO authentication | Must |
| FR-602 | Dashboard SHALL display processing activity log | Must |
| FR-603 | Dashboard SHALL show processing statistics and charts | Should |
| FR-604 | Dashboard SHALL provide error tracking with CSV export | Should |
| FR-605 | Dashboard SHALL allow knowledge base management (CRUD) | Must |
| FR-606 | Dashboard SHALL show system health status | Must |
| FR-607 | Dashboard SHALL display Cloudflare email intake analytics | Should |
| FR-608 | Dashboard SHALL provide E2E pipeline health tests | Should |

### 3.7 Logging & Monitoring (FR-700)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-701 | System SHALL log every processing attempt to Firestore | Must |
| FR-702 | Logs SHALL include: sender, subject, status, timing, target person | Must |
| FR-703 | System SHALL store filled PDFs in Cloud Storage | Must |
| FR-704 | System SHALL track processing time for each request | Should |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-101 | Form processing time | < 60 seconds |
| NFR-102 | Email worker response time | < 5 seconds |
| NFR-103 | Dashboard page load time | < 3 seconds |

### 4.2 Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-201 | System availability | 99.5% |
| NFR-202 | Graceful error handling | Always reply to sender |
| NFR-203 | Post-deploy E2E smoke tests | On every deployment |

### 4.3 Scalability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-301 | Concurrent processing | Up to 3 instances |
| NFR-302 | Cold start time | < 30 seconds |
| NFR-303 | Scale to zero when idle | Yes |

### 4.4 Security

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-401 | Webhook authentication | Bearer token |
| NFR-402 | Dashboard authentication | Google SSO |
| NFR-403 | Prompt injection detection | Block at ≥70% risk |
| NFR-404 | Code execution isolation | Restricted namespace |

---

## 5. Data Requirements

### 5.1 Family Data (`family_data.json`)

- Family members: name (Hebrew/English), ID, birth date, contact info
- Address: street, city, ZIP (Hebrew/English)
- Medical: diagnosis, doctor, HMO
- School information per child
- Instruction parsing keywords (Hebrew/English)

### 5.2 Knowledge Base (Firestore)

- Key-value entries per person or family-wide
- Categories: medical, educational, administrative
- CRUD operations via dashboard

### 5.3 Processing Logs (Firestore)

- One document per processing attempt
- Fields: sender, subject, status, target person, timing, error details
- Filled PDF path in GCS

---

## 6. Interface Requirements

### 6.1 Email Interface

- **Input:** Email with PDF or image attachment(s)
- **Supported formats:** PDF, JPG, PNG, WEBP, HEIC
- **Instructions:** Subject line and/or body text in Hebrew or English
- **Output:** Reply email with filled PDF attachment

### 6.2 Dashboard Interface

- **URL:** https://formclaw.savlil.com
- **Auth:** Google SSO (whitelisted accounts)
- **Pages:** Dashboard, Activity, Statistics, Errors, Knowledge, System
- **Responsive:** Desktop-optimized

### 6.3 Processor API

- **Endpoint:** POST /webhook
- **Auth:** Bearer token
- **Health:** GET /health
- **Format:** JSON request/response
