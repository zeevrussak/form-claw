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
from PIL import Image, ImageDraw, ImageFont

from security_filter import scan_email_content
from form_filler import execute_fill_code
from llm_instructions import (
    FORM_ANALYSIS_SYSTEM,
    build_analysis_prompt,
    CODE_GENERATION_SYSTEM,
    build_code_generation_prompt,
)

# Supported image extensions
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.heic'}
IMAGE_MIMES = {'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'}

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
app = FastAPI(title="Form Claw Processor", version="1.0.0")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("formclaw")

# Register HEIC/HEIF support with Pillow
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    log.info("HEIC/HEIF support registered")
except ImportError:
    log.warning("pillow-heif not installed — HEIC images won't be supported")

db = firestore.Client()
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
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

    # --- Handle intake_drop events (email received but no PDFs) ---
    if payload.get("type") == "intake_drop":
        return await _handle_intake_drop(payload)

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

        # ----- Extract attachments (PDF or images) -----
        attachments = payload.get("attachments", [])
        pdf_attachments = [a for a in attachments if is_pdf_attachment(a)]
        image_attachments = [a for a in attachments if is_image_attachment(a)]

        if not pdf_attachments and not image_attachments:
            raise ValueError("No PDF or image attachments found")

        converted_from_images = False
        if pdf_attachments:
            # Use the first PDF
            pdf_data = base64.b64decode(pdf_attachments[0]["contentBase64"])
            pdf_filename = pdf_attachments[0].get("filename", "form.pdf")
            log.info(f"PDF: {pdf_filename} ({len(pdf_data)} bytes)")
        else:
            # Convert images to PDF
            log.info(f"No PDF found. Converting {len(image_attachments)} image(s) to PDF...")
            image_bytes_list = [
                base64.b64decode(a["contentBase64"]) for a in image_attachments
            ]
            pdf_data = images_to_pdf(image_bytes_list)
            # Name the output after the first image
            first_name = image_attachments[0].get("filename", "form")
            base_name = os.path.splitext(first_name)[0]
            pdf_filename = f"{base_name}.pdf"
            converted_from_images = True
            log.info(f"Converted to PDF: {pdf_filename} ({len(pdf_data)} bytes, {len(image_attachments)} image(s))")

        source_type = "image" if converted_from_images else "pdf"
        attachment_count = len(pdf_attachments) + len(image_attachments)
        image_count = len(image_attachments) if converted_from_images else 0

        return await _analyze_generate_fill_and_reply(
            pdf_data=pdf_data,
            pdf_filename=pdf_filename,
            subject=subject,
            sender=sender,
            text_body=text_body,
            message_id=message_id,
            in_reply_to=in_reply_to,
            references=references,
            log_ref=log_ref,
            source_type=source_type,
            converted_from_images=converted_from_images,
            attachment_count=attachment_count,
            image_count=image_count,
            start_time=start_time,
        )

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
# Core pipeline: analyze -> generate -> fill -> (reply | ask for missing data)
# ---------------------------------------------------------------------------
async def _analyze_generate_fill_and_reply(
    *,
    pdf_data: bytes,
    pdf_filename: str,
    subject: str,
    sender: str,
    text_body: str,
    message_id: str,
    in_reply_to: str,
    references: str,
    log_ref,
    source_type: str = "pdf",
    converted_from_images: bool = False,
    attachment_count: int = 1,
    image_count: int = 0,
    start_time: float = None,
):
    """Run the full fill pipeline and either reply with the filled PDF or,
    if required data is missing, email the sender to ask for it (and store a
    pending_forms doc so the reply can be resumed)."""
    if start_time is None:
        start_time = time.time()

    # ----- Convert PDF pages to images (with coordinate-grid overlay so the
    #       vision model can read exact PDF-point placement coordinates) -----
    page_images = pdf_to_grid_images(pdf_data)
    log.info(f"Converted {len(page_images)} pages to grid images")

    # ----- LLM Vision Analysis -----
    analysis = await analyze_form(page_images, subject, text_body)
    target_person = extract_target_person(analysis, subject, text_body)
    log.info(f"Analysis complete. Target person: {target_person}")

    # ----- Generate fill code -----
    fill_code = await generate_fill_code(page_images, analysis, target_person)
    log.info(f"Generated fill code ({len(fill_code)} chars)")
    log.info(f"Fill code preview:\n{fill_code[:2000]}")

    # ----- Execute fill code (with retry on quality check failure) -----
    max_attempts = 2
    filled_pdf = None
    fill_quality = None
    missing_fields = []
    for attempt in range(1, max_attempts + 1):
        try:
            attempt_code = fill_code if attempt == 1 else await generate_fill_code(page_images, analysis, target_person)
            if attempt > 1:
                log.info(f"Retry attempt {attempt}: regenerated fill code ({len(attempt_code)} chars)")
                log.info(f"Retry code preview:\n{attempt_code[:2000]}")
                fill_code = attempt_code

            filled_pdf, missing_fields = execute_fill_code(fill_code, pdf_data, FAMILY_DATA)
            log.info(f"Filled PDF: {len(filled_pdf)} bytes (attempt {attempt}); "
                     f"{len(missing_fields)} missing field(s)")

            fill_quality = verify_fill_quality(pdf_data, filled_pdf)
            log.info(f"Fill quality check: {fill_quality}")

            if fill_quality["passed"]:
                break
            else:
                log.warning(f"Fill quality check FAILED (attempt {attempt}): {fill_quality['reason']}")
                if attempt < max_attempts:
                    log.info("Retrying with fresh code generation...")
        except Exception as e:
            log.error(f"Fill attempt {attempt} failed: {e}")
            if attempt >= max_attempts:
                raise

    if filled_pdf is None:
        raise RuntimeError("All fill attempts failed")

    # ----- If required data is missing, ask the sender instead of sending a
    #       partially-filled / invented form. -----
    if missing_fields:
        log.info(f"{len(missing_fields)} required field(s) missing — requesting from sender")
        return await _request_missing_fields(
            pdf_data=pdf_data,
            pdf_filename=pdf_filename,
            subject=subject,
            sender=sender,
            target_person=target_person,
            missing_fields=missing_fields,
            message_id=message_id,
            in_reply_to=in_reply_to,
            references=references,
            log_ref=log_ref,
            analysis=analysis,
            start_time=start_time,
        )

    # ----- Reply via Resend (no document retention) -----
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
            "content": list(filled_pdf),
        }]
    })
    log.info(f"Reply sent to {sender}")

    elapsed = time.time() - start_time
    log_ref.update({
        "processing_status": "success",
        "target_person": target_person,
        "attachment_filename": pdf_filename,
        "attachment_count": attachment_count,
        "source_type": source_type,
        "converted_from_images": converted_from_images,
        "image_count": image_count,
        "page_count": len(page_images),
        "filled_pdf_path": None,
        "processing_time_seconds": round(elapsed, 2),
        "processing_completed_at": datetime.now(timezone.utc),
        "llm_provider": f"google/{GEMINI_MODEL}",
        "instructions_detected": text_body.strip()[:500] if text_body.strip() else None,
        "llm_analysis": analysis[:5000] if analysis else None,
        "generated_code": fill_code[:5000] if fill_code else None,
        "fill_quality": fill_quality,
    })

    return {"status": "success", "id": log_ref.id, "target": target_person, "time": round(elapsed, 2)}


# ---------------------------------------------------------------------------
# Missing-field request + reply-to-reply resume
# ---------------------------------------------------------------------------
import re as _re


def _bare_email(addr: str) -> str:
    """Extract a bare lowercase email address from a From header value."""
    if not addr:
        return ""
    m = _re.search(r"[\w.+-]+@[\w.-]+\.\w+", addr)
    return (m.group(0).lower() if m else addr.strip().lower())


def _normalize_subject(subject: str) -> str:
    """Strip Re:/Fwd: prefixes and normalize whitespace/case for matching."""
    s = subject or ""
    prev = None
    while prev != s:
        prev = s
        s = _re.sub(r"^\s*(re|fw|fwd|תשובה|העברה)\s*:\s*", "", s, flags=_re.IGNORECASE)
    return _re.sub(r"\s+", " ", s).strip().lower()


def _find_pending_form(sender: str, subject: str):
    """Return (doc_ref, data) of an awaiting-reply pending form matching the
    sender and (normalized) subject, or (None, None)."""
    bare = _bare_email(sender)
    if not bare:
        return None, None
    norm = _normalize_subject(subject)
    docs = list(
        db.collection("pending_forms")
        .where("status", "==", "awaiting_reply")
        .where("sender_email", "==", bare)
        .stream()
    )
    candidates = []
    for d in docs:
        data = d.to_dict()
        if data.get("normalized_subject") == norm or not norm:
            candidates.append((d.reference, data))
    if not candidates:
        # Fall back: any awaiting-reply form from this sender (subject may have drifted)
        candidates = [(d.reference, d.to_dict()) for d in docs]
    if not candidates:
        return None, None
    # Most recent by created_at
    candidates.sort(key=lambda t: t[1].get("created_at") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return candidates[0]


def _format_missing_fields(missing_fields: list[dict]) -> str:
    lines = []
    for i, m in enumerate(missing_fields, 1):
        label = m.get("label", "?")
        page = m.get("page")
        hint = m.get("hint", "")
        loc = f" (page {page})" if page else ""
        extra = f" — {hint}" if hint else ""
        lines.append(f"{i}. {label}{loc}{extra}")
    return "\n".join(lines)


async def _request_missing_fields(
    *,
    pdf_data: bytes,
    pdf_filename: str,
    subject: str,
    sender: str,
    target_person: str,
    missing_fields: list[dict],
    message_id: str,
    in_reply_to: str,
    references: str,
    log_ref,
    analysis: str = "",
    start_time: float = None,
):
    """Store the form as pending and email the sender for the missing values."""
    if start_time is None:
        start_time = time.time()

    pending_ref = db.collection("pending_forms").document()
    bare = _bare_email(sender)
    norm = _normalize_subject(subject)

    # Stash the original PDF in GCS (avoids Firestore 1MB doc limit)
    pdf_gcs_path = f"pending/{pending_ref.id}.pdf"
    try:
        bucket = storage.Client().bucket(GCS_BUCKET)
        bucket.blob(pdf_gcs_path).upload_from_string(pdf_data, content_type="application/pdf")
    except Exception as e:
        log.error(f"Failed to stash pending PDF in GCS: {e}")
        pdf_gcs_path = None

    pending_ref.set({
        "sender_email": bare,
        "sender_full": sender,
        "subject": subject,
        "normalized_subject": norm,
        "pdf_gcs_path": pdf_gcs_path,
        "pdf_filename": pdf_filename,
        "target_person": target_person,
        "missing_fields": missing_fields,
        "status": "awaiting_reply",
        "created_at": datetime.now(timezone.utc),
        "message_id": message_id,
        "references": references or in_reply_to or message_id,
        "log_id": log_ref.id,
    })

    field_list = _format_missing_fields(missing_fields)
    reply_text = (
        f"שלום,\n\n"
        f"קיבלתי את הטופס (\u200e{pdf_filename}). כדי למלא אותו במלואו חסרים לי הנתונים הבאים. "
        f"אנא השב/י למייל זה עם הערכים, שורה לכל שדה בפורמט \"שם השדה: ערך\":\n\n"
        f"{field_list}\n\n"
        f"לאחר שאקבל את הפרטים אמלא את הטופס ואשלח אותו חזרה.\n"
        f"— Form Claw Bot\n\n"
        f"----------------------------------------\n\n"
        f"Hi,\n\n"
        f"I received your form ({pdf_filename}). To complete it I'm missing the following "
        f"information. Please reply to this email with the values, one field per line in the "
        f"format \"Field: value\":\n\n"
        f"{field_list}\n\n"
        f"Once you reply, I'll fill the form and send it back.\n"
        f"— Form Claw Bot"
    )

    reply_headers = []
    if in_reply_to or message_id:
        reply_headers.append({"name": "In-Reply-To", "value": in_reply_to or message_id})
        reply_headers.append({"name": "References", "value": references or in_reply_to or message_id})

    try:
        resend.Emails.send({
            "from": RESEND_FROM,
            "to": [sender],
            "subject": f"Re: {subject} [Missing information needed]",
            "text": reply_text,
            "headers": reply_headers if reply_headers else None,
        })
        log.info(f"Missing-fields request sent to {sender} ({len(missing_fields)} fields)")
    except Exception as e:
        log.error(f"Failed to send missing-fields request: {e}")

    elapsed = time.time() - start_time
    log_ref.update({
        "processing_status": "awaiting_reply",
        "target_person": target_person,
        "attachment_filename": pdf_filename,
        "missing_fields": missing_fields,
        "pending_form_id": pending_ref.id,
        "processing_time_seconds": round(elapsed, 2),
        "processing_completed_at": datetime.now(timezone.utc),
        "llm_analysis": analysis[:5000] if analysis else None,
    })

    return {
        "status": "awaiting_reply",
        "id": log_ref.id,
        "pending_form_id": pending_ref.id,
        "missing_fields": [m.get("label") for m in missing_fields],
    }


def _parse_reply_answers(text_body: str) -> list[dict]:
    """Parse 'Label: value' pairs from a reply body. Ignores quoted history
    (lines starting with '>') and the bot's own signature block."""
    answers = []
    for raw in (text_body or "").splitlines():
        line = raw.strip()
        if not line or line.startswith(">"):
            continue
        if line.startswith("--") or line.startswith("—") or line.startswith("____"):
            break  # signature / quoted separator
        # Support both ':' and Hebrew maqaf-less "label: value"
        if ":" in line:
            label, _, value = line.partition(":")
        elif "：" in line:  # full-width colon
            label, _, value = line.partition("：")
        else:
            continue
        label = label.strip()
        value = value.strip()
        if label and value and len(label) <= 200:
            answers.append({"label": label, "value": value[:1000]})
    return answers


def _save_answers_to_knowledge(answers: list[dict], target_person: str):
    """Persist reply answers to the knowledge base for future forms."""
    saved = 0
    for a in answers:
        try:
            db.collection("knowledge_entries").add({
                "key": a["label"],
                "value": a["value"],
                "category": "reply-provided",
                "applies_to_person": target_person if target_person and target_person != "unknown" else None,
                "is_active": True,
                "source": "email-reply",
                "created_at": datetime.now(timezone.utc),
            })
            saved += 1
        except Exception as e:
            log.warning(f"Failed to save knowledge entry '{a.get('label')}': {e}")
    log.info(f"Saved {saved}/{len(answers)} reply answers to knowledge base")
    return saved


async def _resume_pending_form(pending_ref, pending: dict, text_body: str, sender: str):
    """Handle a reply to a missing-fields request: save answers, re-run fill."""
    answers = _parse_reply_answers(text_body)
    target_person = pending.get("target_person", "unknown")
    log.info(f"Resume: parsed {len(answers)} answer line(s) from reply")

    if answers:
        _save_answers_to_knowledge(answers, target_person)

    # Mark the pending form resolved so it won't match again
    pending_ref.update({
        "status": "resumed",
        "resumed_at": datetime.now(timezone.utc),
        "reply_answers": answers,
    })

    # Retrieve the original PDF from GCS
    pdf_gcs_path = pending.get("pdf_gcs_path")
    if not pdf_gcs_path:
        log.error("Pending form has no stored PDF path — cannot resume")
        return {"status": "error", "reason": "missing stored PDF"}
    try:
        bucket = storage.Client().bucket(GCS_BUCKET)
        pdf_data = bucket.blob(pdf_gcs_path).download_as_bytes()
    except Exception as e:
        log.error(f"Failed to retrieve pending PDF from GCS: {e}")
        return {"status": "error", "reason": f"could not load stored PDF: {e}"}

    subject = pending.get("subject", "")
    pdf_filename = pending.get("pdf_filename", "form.pdf")
    references = pending.get("references", "")
    message_id = pending.get("message_id", "")

    # Fresh processing log for the resumed attempt
    log_ref = db.collection("form_processing_logs").document()
    log_ref.set({
        "received_at": datetime.now(timezone.utc),
        "sender_email": _bare_email(sender),
        "subject": subject,
        "processing_status": "processing",
        "resumed_from_pending": pending_ref.id,
        "answers_provided": len(answers),
    })

    return await _analyze_generate_fill_and_reply(
        pdf_data=pdf_data,
        pdf_filename=pdf_filename,
        subject=subject,
        sender=sender,
        text_body="",  # instructions already captured; answers now in knowledge base
        message_id=message_id,
        in_reply_to=message_id,
        references=references,
        log_ref=log_ref,
        source_type="pdf",
    )


# ---------------------------------------------------------------------------
# Intake drop handler
# ---------------------------------------------------------------------------
async def _handle_intake_drop(payload: dict):
    """Log and reply when email had no processable PDF attachments."""
    sender = payload.get("from", "unknown")
    subject = payload.get("subject", "")
    reason = payload.get("reason", "Unknown reason")
    message_id = payload.get("messageId", payload.get("message_id", ""))
    in_reply_to = payload.get("inReplyTo", payload.get("in_reply_to", ""))
    references = payload.get("references", "")
    text_body = payload.get("text_body", payload.get("textBody", payload.get("text", "")))
    attachment_summary = payload.get("attachmentSummary", [])

    log.info(f"Intake drop from={sender} subject='{subject}' reason='{reason}'")

    # --- Reply-to-reply: is this an answer to a pending missing-fields request? ---
    try:
        pending_ref, pending = _find_pending_form(sender, subject)
    except Exception as e:
        log.warning(f"Pending-form lookup failed: {e}")
        pending_ref, pending = None, None
    if pending_ref is not None and pending is not None:
        log.info(f"Matched pending form {pending_ref.id} for {sender} — resuming with reply answers")
        return await _resume_pending_form(pending_ref, pending, text_body, sender)

    # Log to Firestore
    log_ref = db.collection("form_processing_logs").document()
    log_ref.set({
        "received_at": datetime.now(timezone.utc),
        "email_message_id": message_id,
        "sender_email": sender,
        "subject": subject,
        "processing_status": "dropped",
        "error_type": "IntakeDrop",
        "error_message": reason,
        "attachment_summary": [{
            "filename": a.get("filename"),
            "mimeType": a.get("mimeType"),
            "size": a.get("size"),
        } for a in attachment_summary],
        "processing_time_seconds": 0,
        "processing_completed_at": datetime.now(timezone.utc),
    })

    # Send reply to sender explaining the issue
    att_detail = ""
    if attachment_summary:
        att_lines = []
        for a in attachment_summary:
            att_lines.append(f"  - {a.get('filename', '?')} ({a.get('mimeType', '?')}, {a.get('size', 0)} bytes)")
        att_detail = "\n\nAttachments received:\n" + "\n".join(att_lines)

    reply_text = (
        f"Hi,\n\n"
        f"Your email was received but could not be processed:\n\n"
        f"{reason}\n"
        f"{att_detail}\n\n"
        f"Please resend with a PDF form or image (JPG, PNG, WEBP, HEIC) attached and I'll fill it out for you.\n\n"
        f"— Form Claw Bot"
    )

    try:
        reply_headers = []
        if in_reply_to or message_id:
            reply_headers.append({"name": "In-Reply-To", "value": in_reply_to or message_id})
            reply_headers.append({"name": "References", "value": references or in_reply_to or message_id})

        resend.Emails.send({
            "from": RESEND_FROM,
            "to": [sender],
            "subject": f"Re: {subject} [NO PDF FOUND]",
            "text": reply_text,
            "headers": reply_headers if reply_headers else None,
        })
        log.info(f"Drop notification sent to {sender}")
    except Exception as e:
        log.error(f"Failed to send drop notification: {e}")

    return {"status": "dropped", "id": log_ref.id, "reason": reason}


# ---------------------------------------------------------------------------
# Image → PDF conversion
# ---------------------------------------------------------------------------
def is_image_attachment(att: dict) -> bool:
    """Check if attachment is a supported image type."""
    mime = att.get("mimeType", "").lower()
    fname = att.get("filename", "").lower()
    ext = os.path.splitext(fname)[1]
    return mime in IMAGE_MIMES or ext in IMAGE_EXTENSIONS or att.get("kind") == "image"


def is_pdf_attachment(att: dict) -> bool:
    """Check if attachment is a PDF."""
    mime = att.get("mimeType", "").lower()
    fname = att.get("filename", "").lower()
    return mime == "application/pdf" or fname.endswith(".pdf") or att.get("kind") == "pdf"


def images_to_pdf(image_bytes_list: list[bytes]) -> bytes:
    """
    Convert one or more images to a single PDF.
    Each image becomes one page, sized to fit the image at 72 DPI.
    """
    pil_images = []
    for img_bytes in image_bytes_list:
        img = Image.open(io.BytesIO(img_bytes))
        # Convert to RGB if needed (HEIC may be RGBA, PNG may be P/RGBA)
        if img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')
        pil_images.append(img)

    if not pil_images:
        raise ValueError("No images to convert")

    # Save as multi-page PDF
    buf = io.BytesIO()
    if len(pil_images) == 1:
        pil_images[0].save(buf, format="PDF", resolution=72)
    else:
        pil_images[0].save(
            buf, format="PDF", resolution=72,
            save_all=True, append_images=pil_images[1:]
        )
    return buf.getvalue()


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


def pdf_to_grid_images(pdf_bytes: bytes, dpi: int = 150, step: int = 50) -> list[bytes]:
    """Convert PDF pages to PNG images with a labeled coordinate-grid overlay.

    The grid labels are in **PDF points** using the PDF coordinate system
    (origin bottom-left, y increasing upward). This lets the vision model read
    off exact placement coordinates instead of guessing pixel positions.
    Vertical (red) lines mark x-points; horizontal (blue) lines mark y-points.
    """
    import PyPDF2
    try:
        reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
        dims = [(float(p.mediabox.width), float(p.mediabox.height)) for p in reader.pages]
    except Exception:
        dims = []
    pil_images = convert_from_bytes(pdf_bytes, dpi=dpi)
    scale = dpi / 72.0
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
    except Exception:
        try:
            font = ImageFont.truetype("DejaVuSans-Bold.ttf", 16)
        except Exception:
            font = ImageFont.load_default()
    result = []
    for idx, img in enumerate(pil_images):
        if idx < len(dims):
            w_pts, h_pts = dims[idx]
        else:
            w_pts, h_pts = img.width / scale, img.height / scale
        img = img.convert("RGB")
        draw = ImageDraw.Draw(img)
        W, H = img.size
        x = 0
        while x <= w_pts:
            px = x * scale
            draw.line([(px, 0), (px, H)], fill=(255, 0, 0), width=1)
            draw.text((px + 2, 2), str(int(x)), fill=(200, 0, 0), font=font)
            draw.text((px + 2, H - 20), str(int(x)), fill=(200, 0, 0), font=font)
            x += step
        y = 0
        while y <= h_pts:
            py = (h_pts - y) * scale
            draw.line([(0, py), (W, py)], fill=(0, 0, 255), width=1)
            draw.text((2, py + 1), str(int(y)), fill=(0, 0, 200), font=font)
            draw.text((W - 42, py + 1), str(int(y)), fill=(0, 0, 200), font=font)
            y += step
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

    prompt = build_analysis_prompt(subject, body)
    content = [{"type": "text", "text": prompt}] + image_parts
    return await call_gemini(
        [
            {"role": "system", "content": FORM_ANALYSIS_SYSTEM},
            {"role": "user", "content": content},
        ],
        max_tokens=8192,
    )

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

    prompt = build_code_generation_prompt(
        analysis=analysis,
        target_person=target_person,
        family_data=FAMILY_DATA,
        knowledge=knowledge,
    )
    content = [{"type": "text", "text": prompt}] + image_parts
    response = await call_gemini(
        [
            {"role": "system", "content": CODE_GENERATION_SYSTEM},
            {"role": "user", "content": content},
        ],
        max_tokens=16384,
    )

    # Extract code from markdown code block
    if "```python" in response:
        code = response.split("```python")[1].split("```")[0]
    elif "```" in response:
        code = response.split("```")[1].split("```")[0]
    else:
        code = response

    return code.strip()


async def load_knowledge(target_person: str) -> list[dict]:
    """
    Load relevant knowledge entries from Firestore.

    A form for a child needs the child's data AND both parents' data AND
    family-wide data (address, family name, HMO). Family-wide entries are
    stored with applies_to_person == None (not the literal "Family-wide"),
    and parent entries under the parent's name — so we load ALL active
    entries and let the LLM use whatever is relevant. The knowledge base is
    small (tens of entries), so loading everything is cheap and avoids the
    previous bug where family-wide/parent data was silently dropped.
    """
    entries = []
    try:
        docs = (
            db.collection("knowledge_entries")
            .where("is_active", "==", True)
            .stream()
        )
        for doc in docs:
            d = doc.to_dict()
            entries.append({
                "key": d.get("key"),
                "value": d.get("value"),
                "category": d.get("category"),
                "applies_to_person": d.get("applies_to_person"),
            })
        log.info(f"Loaded {len(entries)} active knowledge entries (target={target_person})")
    except Exception as e:
        log.warning(f"Could not load knowledge entries: {e}")
    return entries


def verify_fill_quality(original_pdf: bytes, filled_pdf: bytes) -> dict:
    """
    Verify that the filled PDF actually has content added compared to the original.
    Uses multiple heuristics:
    1. Size increase (filled should be larger due to overlay content)
    2. Text content extraction (filled should have more text)
    """
    result = {"passed": False, "reason": "", "details": {}}

    # Check 1: Size comparison
    orig_size = len(original_pdf)
    filled_size = len(filled_pdf)
    size_increase = filled_size - orig_size
    size_ratio = filled_size / max(orig_size, 1)
    result["details"]["original_size"] = orig_size
    result["details"]["filled_size"] = filled_size
    result["details"]["size_increase"] = size_increase
    result["details"]["size_ratio"] = round(size_ratio, 3)

    # A properly filled form should add at least some overlay content
    # Minimum: 500 bytes increase (even a few text fields + font adds this)
    if size_increase < 500:
        result["reason"] = f"Filled PDF barely larger than original ({size_increase} bytes increase). Form likely unfilled."
        return result

    # Check 2: Extract text from filled PDF to verify content was added
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(io.BytesIO(filled_pdf))
        filled_text = ""
        for page in reader.pages:
            page_text = page.extract_text() or ""
            filled_text += page_text

        # Also check original for comparison
        orig_reader = PdfReader(io.BytesIO(original_pdf))
        orig_text = ""
        for page in orig_reader.pages:
            page_text = page.extract_text() or ""
            orig_text += page_text

        new_text_len = len(filled_text) - len(orig_text)
        result["details"]["original_text_len"] = len(orig_text)
        result["details"]["filled_text_len"] = len(filled_text)
        result["details"]["new_text_added"] = new_text_len

        # Check if meaningful text was added (at least a name + date)
        if new_text_len < 10:
            result["reason"] = f"Almost no new text extracted from filled PDF ({new_text_len} chars). Fields may be empty."
            return result
    except Exception as e:
        log.warning(f"Text extraction check failed (non-fatal): {e}")
        result["details"]["text_check_error"] = str(e)

    # All checks passed
    result["passed"] = True
    result["reason"] = "Fill quality OK"
    return result


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