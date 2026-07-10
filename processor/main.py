#!/usr/bin/env python3
"""
Form Claw — Cloud Run Form Processor

Receives webhook from Cloudflare Email Worker, uses Gemini 2.5 Flash
for vision analysis, generates Python fill code, executes it with
ReportLab + PyPDF2, and replies via Resend API.
"""

import os
import io
import json
import base64
import time
import traceback
import logging
from datetime import datetime, timezone

import httpx
import resend
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from google.cloud import firestore, storage
from pdf2image import convert_from_bytes
from PIL import Image

from security_filter import scan_email_content
from form_filler import execute_fill_code

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
app = FastAPI(title="Form Claw Processor", version="1.0.0")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("formclaw")

db = firestore.Client()
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GCS_BUCKET = os.environ.get("GCS_BUCKET", "formclaw-assets")

# Resend
resend.api_key = os.environ["RESEND_API_KEY"]
RESEND_FROM = os.environ.get("RESEND_FROM", "Form Claw Bot <formclaw@savlil.com>")

# Family data — loaded from bundled JSON or GCS
FAMILY_DATA_PATH = os.environ.get("FAMILY_DATA_PATH", "family_data.json")
FAMILY_DATA: dict = {}


@app.on_event("startup")
async def load_family_data():
    global FAMILY_DATA
    # Try local file first, then GCS
    if os.path.exists(FAMILY_DATA_PATH):
        with open(FAMILY_DATA_PATH) as f:
            FAMILY_DATA = json.load(f)
        log.info(f"Loaded family data from local file ({len(json.dumps(FAMILY_DATA))} bytes)")
    else:
        try:
            bucket = storage.Client().bucket(GCS_BUCKET)
            blob = bucket.blob("config/family_data.json")
            FAMILY_DATA = json.loads(blob.download_as_text())
            log.info("Loaded family data from GCS")
        except Exception as e:
            log.warning(f"Could not load family data: {e}")
            FAMILY_DATA = {}


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    return {"status": "ok", "service": "formclaw-processor", "timestamp": datetime.now(timezone.utc).isoformat()}


# ---------------------------------------------------------------------------
# Webhook endpoint
# ---------------------------------------------------------------------------
@app.post("/webhook")
async def process_form(request: Request):
    """Receive email payload from Cloudflare Email Worker."""
    start_time = time.time()

    # Auth check
    if WEBHOOK_SECRET:
        token = request.headers.get("Authorization", "").replace("Bearer ", "")
        if token != WEBHOOK_SECRET:
            raise HTTPException(status_code=401, detail="Unauthorized")

    payload = await request.json()
    log_ref = db.collection("form_processing_logs").document()
    sender = payload.get("from", "unknown")
    subject = payload.get("subject", "")
    text_body = payload.get("text_body", payload.get("textBody", ""))
    message_id = payload.get("message_id", payload.get("messageId", ""))
    in_reply_to = payload.get("in_reply_to", payload.get("inReplyTo", ""))
    references = payload.get("references", "")

    log.info(f"Processing form from={sender} subject='{subject}' msgId={message_id}")

    # Initial log entry
    log_ref.set({
        "received_at": datetime.now(timezone.utc),
        "email_message_id": message_id,
        "sender_email": sender,
        "subject": subject,
        "processing_status": "processing",
    })

    try:
        # ----- Security scan -----
        attachment_text = " ".join(
            a.get("filename", "") for a in payload.get("attachments", [])
        )
        verdict = scan_email_content(subject, text_body, attachment_text)
        if verdict.blocked:
            raise ValueError(f"Security filter blocked: {verdict.summary}")

        # ----- Extract PDF -----
        attachments = payload.get("attachments", [])
        pdf_attachments = [
            a for a in attachments
            if a.get("mimeType", "") == "application/pdf"
            or a.get("filename", "").lower().endswith(".pdf")
        ]
        if not pdf_attachments:
            raise ValueError("No PDF attachments found")

        pdf_data = base64.b64decode(pdf_attachments[0]["contentBase64"])
        pdf_filename = pdf_attachments[0].get("filename", "form.pdf")
        log.info(f"PDF: {pdf_filename} ({len(pdf_data)} bytes)")

        # ----- Convert PDF pages to images -----
        page_images = pdf_to_images(pdf_data)
        log.info(f"Converted {len(page_images)} pages to images")

        # ----- LLM Vision Analysis -----
        analysis = await analyze_form(page_images, subject, text_body)
        target_person = extract_target_person(analysis, subject, text_body)
        log.info(f"Analysis complete. Target person: {target_person}")

        # ----- Generate fill code -----
        fill_code = await generate_fill_code(page_images, analysis, target_person)
        log.info(f"Generated fill code ({len(fill_code)} chars)")

        # ----- Execute fill code -----
        filled_pdf = execute_fill_code(fill_code, pdf_data, FAMILY_DATA)
        log.info(f"Filled PDF: {len(filled_pdf)} bytes")

        # ----- Upload to Cloud Storage -----
        bucket = storage.Client().bucket(GCS_BUCKET)
        blob_name = f"filled/{log_ref.id}_{pdf_filename}"
        blob = bucket.blob(blob_name)
        blob.upload_from_string(filled_pdf, content_type="application/pdf")

        # ----- Reply via Resend -----
        reply_headers = []
        if in_reply_to or message_id:
            reply_headers.append({"name": "In-Reply-To", "value": in_reply_to or message_id})
            reply_headers.append({"name": "References", "value": references or in_reply_to or message_id})

        resend.Emails.send({
            "from": RESEND_FROM,
            "to": [sender],
            "subject": f"Re: {subject}",
            "text": f"Filled form attached ({pdf_filename}).\n\nTarget: {target_person}\nProcessed by Form Claw.",
            "headers": reply_headers if reply_headers else None,
            "attachments": [{
                "filename": f"filled_{pdf_filename}",
                "content": list(filled_pdf),  # Resend SDK expects bytes as list
            }]
        })
        log.info(f"Reply sent to {sender}")

        # ----- Update log -----
        elapsed = time.time() - start_time
        log_ref.update({
            "processing_status": "success",
            "target_person": target_person,
            "attachment_filename": pdf_filename,
            "attachment_count": len(pdf_attachments),
            "page_count": len(page_images),
            "filled_pdf_path": blob_name,
            "processing_time_seconds": round(elapsed, 2),
            "processing_completed_at": datetime.now(timezone.utc),
            "llm_provider": f"google/{GEMINI_MODEL}",
            "instructions_detected": text_body.strip()[:500] if text_body.strip() else None,
        })

        return {"status": "success", "id": log_ref.id, "target": target_person, "time": round(elapsed, 2)}

    except Exception as e:
        elapsed = time.time() - start_time
        error_msg = str(e)
        error_type = type(e).__name__
        log.error(f"Processing failed: {error_type}: {error_msg}")
        log.error(traceback.format_exc())

        log_ref.update({
            "processing_status": "failed",
            "error_message": error_msg[:2000],
            "error_type": error_type,
            "processing_time_seconds": round(elapsed, 2),
            "processing_completed_at": datetime.now(timezone.utc),
        })

        # Try to send error notification
        try:
            resend.Emails.send({
                "from": RESEND_FROM,
                "to": [sender],
                "subject": f"Re: {subject} [FAILED]",
                "text": f"Form processing failed:\n\n{error_type}: {error_msg}\n\nPlease try again or contact support.",
            })
        except Exception:
            log.error("Failed to send error notification email")

        raise HTTPException(status_code=500, detail=error_msg)


# ---------------------------------------------------------------------------
# PDF → Image conversion
# ---------------------------------------------------------------------------
def pdf_to_images(pdf_bytes: bytes, dpi: int = 200) -> list[bytes]:
    """Convert PDF pages to PNG images."""
    pil_images = convert_from_bytes(pdf_bytes, dpi=dpi)
    result = []
    for img in pil_images:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        result.append(buf.getvalue())
    return result


# ---------------------------------------------------------------------------
# LLM calls
# ---------------------------------------------------------------------------
async def call_gemini(messages: list[dict], max_tokens: int = 4096) -> str:
    """Call Gemini via OpenAI-compatible endpoint."""
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            GEMINI_URL,
            headers={
                "Authorization": f"Bearer {GEMINI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": GEMINI_MODEL,
                "messages": messages,
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def analyze_form(page_images: list[bytes], subject: str, body: str) -> str:
    """Send PDF pages to Gemini for field analysis."""
    image_parts = [
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64.b64encode(img).decode()}"}}
        for img in page_images
    ]

    prompt = f"""You are analyzing a Hebrew PDF form for automatic filling.

Email subject: "{subject}"
Email body: "{body}"

Analyze the form image(s) and return a structured JSON description of ALL fillable fields, including:
- Field label (Hebrew and/or English)
- Field type: text, checkbox, radio, signature, date, id_digits (9-digit ID with separate boxes)
- Approximate coordinates (x, y in PDF points from bottom-left)
- Field dimensions (width, height)
- Whether it's a selection between options (OR / slash between choices)
- Any special formatting (RTL Hebrew, digit-per-box, etc.)

Also identify:
- Who this form is about (target person) based on subject/body hints
- Who should sign (parent/guardian for children)
- The form's purpose

Return ONLY valid JSON."""

    content = [{"type": "text", "text": prompt}] + image_parts
    return await call_gemini([{"role": "user", "content": content}], max_tokens=8192)


async def generate_fill_code(
    page_images: list[bytes], analysis: str, target_person: str
) -> str:
    """Generate Python code to fill the form using ReportLab."""
    # Load knowledge entries for this person from Firestore
    knowledge = await load_knowledge(target_person)

    image_parts = [
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64.b64encode(img).decode()}"}}
        for img in page_images
    ]

    prompt = f"""You are generating Python code to fill a Hebrew PDF form using ReportLab and PyPDF2.

Form analysis:
{analysis}

Target person: {target_person}

Family data available (JSON):
{json.dumps(FAMILY_DATA, ensure_ascii=False, indent=2)}

Additional knowledge entries:
{json.dumps(knowledge, ensure_ascii=False, indent=2)}

Generate a Python function with this EXACT signature:

```python
def fill_form(input_pdf_bytes: bytes, family_data: dict) -> bytes:
    \"\"\"Fill the PDF form and return filled PDF bytes.\"\"\"\n```

Rules:
1. Use ReportLab canvas to create an overlay, then merge with PyPDF2
2. Hebrew text must be reversed ([::-1]) before drawing with drawRightString
3. Register Hebrew font: pdfmetrics.registerFont(TTFont('Hebrew', 'fonts/FtPilKahol2.ttf'))
4. English text: use Helvetica or register TTFont('English', 'fonts/Playzone.ttf')
5. For ID number digit boxes: draw each digit centered in its box position
6. For OR/slash selections: draw an ellipse around the selected option
7. For checkboxes: draw a checkmark or X
8. For signatures: overlay the PNG with transparency
   - Father signature: 'signatures/zeev_signature.png'
   - Mother signature: 'signatures/keren_signature.png'
9. The page coordinate system has (0,0) at BOTTOM-LEFT
10. Use page.mediabox to get page dimensions
11. Make text fit within field boundaries — don't overflow
12. Today's date: {datetime.now().strftime('%d/%m/%Y')}

Return ONLY the Python code inside ```python ... ``` markers."""

    content = [{"type": "text", "text": prompt}] + image_parts
    response = await call_gemini([{"role": "user", "content": content}], max_tokens=16384)

    # Extract code from markdown code block
    if "```python" in response:
        code = response.split("```python")[1].split("```")[0]
    elif "```" in response:
        code = response.split("```")[1].split("```")[0]
    else:
        code = response

    return code.strip()


async def load_knowledge(target_person: str) -> list[dict]:
    """Load relevant knowledge entries from Firestore."""
    entries = []
    try:
        # Get entries for this person + family-wide
        for person_filter in [target_person, "Family-wide"]:
            docs = (
                db.collection("knowledge_entries")
                .where("is_active", "==", True)
                .where("applies_to_person", "==", person_filter)
                .stream()
            )
            for doc in docs:
                d = doc.to_dict()
                entries.append({"key": d.get("key"), "value": d.get("value"), "category": d.get("category")})
    except Exception as e:
        log.warning(f"Could not load knowledge entries: {e}")
    return entries


def extract_target_person(analysis: str, subject: str, body: str) -> str:
    """Extract target person from LLM analysis or email hints."""
    text = f"{subject} {body} {analysis}".lower()
    # Check for family member mentions
    persons = {
        "savyon": "Savyon", "סביון": "Savyon",
        "clil": "Clil", "כליל": "Clil",
        "keren": "Keren", "קרן": "Keren",
        "zeev": "Ze'ev", "ze'ev": "Ze'ev", "זאב": "Ze'ev",
    }
    for key, name in persons.items():
        if key in text:
            return name
    return "unknown"
