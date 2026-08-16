#!/usr/bin/env python3
"""
Form Filler v2 — Deterministic PDF fill engine.

Instead of executing LLM-generated Python code, this module takes a structured
JSON *fill plan* (produced by the LLM from the form analysis + family data) and
draws every value onto the PDF with plain, tested Python. The LLM decides WHAT
value goes WHERE (with coordinates); this engine is the only thing that renders.

Public entry point:
    execute_fill_plan(fill_plan: dict, pdf_bytes: bytes) -> (filled_bytes, missing_fields)

Coordinate system: PDF points, origin at bottom-left, y increasing upward — the
same system the analysis grid overlay uses, so coordinates are used verbatim.
"""

import io
import os
import logging
from pathlib import Path

import PyPDF2
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from bidi.algorithm import get_display

log = logging.getLogger("formclaw.filler_v2")

# ── Asset locations (bundled in the container) ────────────────────────────────
def _resolve_assets_dir() -> Path:
    """Locate the bundled assets directory.

    In the container the code lives at /app, but the same module is imported
    directly during local testing, where /app does not exist. Prefer an explicit
    ASSETS_DIR, then the directory next to this file, then /app/assets.
    """
    env = os.environ.get("ASSETS_DIR")
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent / "assets"
    if here.is_dir():
        return here
    return Path("/app/assets")


ASSETS_DIR = _resolve_assets_dir()
FONTS_DIR = ASSETS_DIR / "fonts"
SIGNATURES_DIR = ASSETS_DIR / "signatures"

# Hebrew DATA font. This must be a legible print face: an audit of a real filled
# form found that Hebrew values drawn in FtPilKahol2 (a *handwriting/cursive*
# display face) at small sizes were unreadable scribble. Cursive is reserved for
# the handwritten-signature fallback only — never for field data.
HEBREW_FONT_CANDIDATES = [
    FONTS_DIR / "NotoSansHebrew-Regular.ttf",
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),   # has full Hebrew
]
# Cursive face, used only when we must imitate a handwritten signature and no
# signature PNG is available.
HANDWRITING_FONT_PATH = FONTS_DIR / "FtPilKahol2.ttf"

# Font names as registered with ReportLab
HEBREW_FONT = "Hebrew"                  # legible Hebrew print face — field data
HANDWRITING_FONT = "HebrewHand"         # cursive — signature fallback only
LATIN_FONT = "Helvetica"        # built-in — numbers, IDs, emails, dates, English

# Signatures keyed by signer
_SIGNATURE_FILES = {
    "father": SIGNATURES_DIR / "zeev_signature.png",
    "mother": SIGNATURES_DIR / "keren_signature.png",
}

# Rendering constants
MIN_FONT_SIZE = 14.0            # minimum readable font; never start smaller
FLOOR_FONT_SIZE = 8.0           # absolute floor when auto-shrinking to fit width
BASELINE_LIFT = 2.0             # lift the baseline this many pt above fill_y
CIRCLE_PAD = 3.0                # padding around an option word for the ellipse
CIRCLE_LINE_WIDTH = 1.3

_FONTS_REGISTERED = False


def register_fonts() -> None:
    """Register the Hebrew fonts once. Latin uses built-in Helvetica.

    ``HEBREW_FONT`` is a legible print face for field data; ``HANDWRITING_FONT``
    is the cursive face and is only used for a signature fallback.
    """
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return
    registered = pdfmetrics.getRegisteredFontNames()

    if HEBREW_FONT not in registered:
        for path in HEBREW_FONT_CANDIDATES:
            try:
                if not Path(path).exists():
                    continue
                pdfmetrics.registerFont(TTFont(HEBREW_FONT, str(path)))
                log.info(f"Hebrew data font: {path}")
                break
            except Exception as e:
                log.warning(f"Could not register Hebrew font {path}: {e}")
        else:
            log.error("No legible Hebrew font found; falling back to the "
                      "handwriting face, which is hard to read at small sizes")
            try:
                pdfmetrics.registerFont(TTFont(HEBREW_FONT, str(HANDWRITING_FONT_PATH)))
            except Exception as e:
                log.error(f"Failed to register any Hebrew font: {e}")

    if HANDWRITING_FONT not in pdfmetrics.getRegisteredFontNames():
        try:
            pdfmetrics.registerFont(TTFont(HANDWRITING_FONT, str(HANDWRITING_FONT_PATH)))
        except Exception as e:
            log.warning(f"Handwriting font unavailable ({e}); "
                        "signature fallback will use the print face")

    _FONTS_REGISTERED = HEBREW_FONT in pdfmetrics.getRegisteredFontNames()


# ── Text helpers ──────────────────────────────────────────────────────────────

def contains_hebrew(text) -> bool:
    """True if the string contains any Hebrew letter (U+0590–U+05FF)."""
    return any("\u0590" <= ch <= "\u05FF" for ch in str(text))


def shape_he(text) -> str:
    """Apply the Unicode bidi algorithm so Hebrew letters render RTL while any
    embedded digit / Latin runs keep their natural left-to-right order."""
    return get_display(str(text))


def _pick_font(text, is_hebrew: bool | None) -> str:
    """Choose the font by actual content. Hebrew letters require the Hebrew TTF;
    everything else (numbers, IDs, emails, dates) uses Latin Helvetica."""
    if is_hebrew is None:
        is_hebrew = contains_hebrew(text)
    # Even if flagged Hebrew, only use the Hebrew font when Hebrew letters are
    # actually present — protects against boxes for pure-numeric values.
    if is_hebrew and contains_hebrew(text):
        return HEBREW_FONT
    return LATIN_FONT


# ── Field renderers ────────────────────────────────────────────────────────────

def fill_text_field(c, x, y, width, height, text, anchor="right",
                    is_hebrew=None, min_size=MIN_FONT_SIZE):
    """Draw a text value inside a blank field.

    Starts at ``min_size`` (>= 14pt) and only shrinks if the rendered string is
    wider than ``width`` (down to a readable floor). The baseline is lifted a
    couple points above ``y`` so letters rest on the underline / cell rule.
    """
    if text is None or str(text).strip() == "":
        return
    text = str(text)

    font = _pick_font(text, is_hebrew)
    draw_str = shape_he(text) if font == HEBREW_FONT else text

    size = float(min_size)
    # A blank that is physically shorter than the glyphs would let the value
    # climb into the printed caption above it. Cap by height BEFORE width.
    if height and height > 1.0:
        size = min(size, max(FLOOR_FONT_SIZE, height * 0.92))
    if width and width > 0:
        # Shrink only when the text is wider than the available blank.
        while size > FLOOR_FONT_SIZE and c.stringWidth(draw_str, font, size) > width:
            size -= 0.5

    c.setFont(font, size)
    baseline = y + BASELINE_LIFT

    if anchor == "right":
        c.drawRightString(x, baseline, draw_str)
    elif anchor == "center":
        cx = x + (width / 2.0 if width else 0)
        c.drawCentredString(cx, baseline, draw_str)
    else:  # "left"
        c.drawString(x, baseline, draw_str)


def fill_id_boxes(c, x_left, y, total_width, height, id_str):
    """Fill a 9-box Israeli Teudat Zehut grid.

    The digit string is left-to-right (e.g. "034954990"). Israeli ID grids are
    RTL: the FIRST digit belongs in the RIGHTMOST box. Each digit is centered in
    its box.
    """
    if not id_str:
        return
    digits = [ch for ch in str(id_str) if ch.isdigit()]
    if not digits:
        return

    n_boxes = 9
    box_width = (total_width / n_boxes) if total_width else 0
    size = float(MIN_FONT_SIZE)
    # keep digit within a box
    if box_width:
        while size > FLOOR_FONT_SIZE and c.stringWidth("0", LATIN_FONT, size) > box_width * 0.8:
            size -= 0.5
    c.setFont(LATIN_FONT, size)
    baseline = y + BASELINE_LIFT

    # First digit -> rightmost box. Digit i (0-based, LTR order) goes into the
    # box counted from the right: center x = x_left + total_width - (i+0.5)*box_width
    for i, digit in enumerate(digits[:n_boxes]):
        center_x = x_left + total_width - (i + 0.5) * box_width
        c.drawCentredString(center_x, baseline, digit)


def fill_checkbox(c, x, y, width, height):
    """Draw a check mark centered in a checkbox."""
    size = float(min(height * 0.9, MIN_FONT_SIZE)) if height else MIN_FONT_SIZE
    if size < FLOOR_FONT_SIZE:
        size = FLOOR_FONT_SIZE
    c.setFont(LATIN_FONT, size)
    cx = x + (width / 2.0 if width else 0)
    cy = y + (height / 2.0 if height else 0) - size * 0.35
    c.drawCentredString(cx, cy, "\u2713")  # ✓


def fill_circle_option(c, x, y, width, height):
    """Stroke a tight ellipse around a chosen option word.

    The (x, y, width, height) describe the option word's bounding area; the
    ellipse is drawn with a small padding around it (stroke only, no fill).
    """
    x0 = x - CIRCLE_PAD
    y0 = y - CIRCLE_PAD
    x1 = x + (width or 0) + CIRCLE_PAD
    y1 = y + (height or MIN_FONT_SIZE) + CIRCLE_PAD
    c.saveState()
    c.setLineWidth(CIRCLE_LINE_WIDTH)
    c.ellipse(x0, y0, x1, y1, stroke=1, fill=0)
    c.restoreState()


def fill_signature(c, x, y, width, height, signer):
    """Draw a signature PNG scaled to fit the signature box, preserving alpha."""
    key = str(signer or "").strip().lower()
    path = _SIGNATURE_FILES.get(key)
    if path is None or not Path(path).exists():
        log.warning(f"No signature asset for signer={signer!r} (path={path})")
        return
    w = width if width and width > 0 else 120
    h = height if height and height > 0 else 45
    try:
        c.drawImage(str(path), x, y, width=w, height=h,
                    mask="auto", preserveAspectRatio=True)
    except Exception as e:
        log.error(f"Failed to draw signature {path}: {e}")


# ── Dispatch ────────────────────────────────────────────────────────────────────

# field_type values that render as plain text
_TEXT_TYPES = {"text", "date", "phone", "email", "address", "number", "select"}


def _draw_fill(c, fill: dict):
    """Draw a single fill entry onto the current canvas page."""
    ftype = str(fill.get("field_type", "text")).lower()
    x = float(fill.get("fill_x", fill.get("x", 0)) or 0)
    y = float(fill.get("fill_y", fill.get("y", 0)) or 0)
    width = float(fill.get("fill_width", fill.get("width", 0)) or 0)
    height = float(fill.get("fill_height", fill.get("height", 0)) or 0)
    anchor = str(fill.get("fill_anchor", fill.get("anchor", "right")) or "right").lower()
    is_hebrew = fill.get("is_hebrew")
    value = fill.get("value")

    if ftype == "id_digits":
        fill_id_boxes(c, x, y, width, height, value)
    elif ftype == "checkbox":
        fill_checkbox(c, x, y, width, height)
    elif ftype in ("circle_option", "radio"):
        fill_circle_option(c, x, y, width, height)
    elif ftype == "signature":
        fill_signature(c, x, y, width, height, value)
    elif ftype in _TEXT_TYPES:
        fill_text_field(c, x, y, width, height, value, anchor=anchor, is_hebrew=is_hebrew)
    else:
        # Unknown type: best-effort as text if there is a value.
        if value not in (None, ""):
            fill_text_field(c, x, y, width, height, value, anchor=anchor, is_hebrew=is_hebrew)


def _normalize_missing(missing) -> list:
    """Clean and de-duplicate the missing-fields list from the plan."""
    clean = []
    seen = set()
    if not isinstance(missing, list):
        return clean
    for m in missing:
        if isinstance(m, dict) and m.get("label"):
            key = (m.get("label"), m.get("page"))
            if key not in seen:
                seen.add(key)
                clean.append({
                    "label": str(m.get("label"))[:200],
                    "page": m.get("page"),
                    "hint": str(m.get("hint", ""))[:300],
                })
        elif isinstance(m, str) and m.strip():
            if m not in seen:
                seen.add(m)
                clean.append({"label": m[:200], "page": None, "hint": ""})
    return clean


def execute_fill_plan(fill_plan: dict, pdf_bytes: bytes):
    """Render a JSON fill plan onto the PDF deterministically.

    Args:
        fill_plan: dict with keys ``fills`` (list of fill entries, each carrying
            page + coordinates + field_type + value) and ``missing_fields``.
        pdf_bytes: the original blank PDF.

    Returns:
        (filled_pdf_bytes, missing_fields_list)
    """
    register_fonts()

    if not isinstance(fill_plan, dict):
        raise RuntimeError(f"fill_plan must be a dict, got {type(fill_plan).__name__}")

    fills = fill_plan.get("fills", []) or []
    missing_fields = _normalize_missing(fill_plan.get("missing_fields", []))

    # Group fills by page number (1-indexed in the plan).
    fills_by_page: dict[int, list] = {}
    for f in fills:
        if not isinstance(f, dict):
            continue
        try:
            page_no = int(f.get("page", 1) or 1)
        except (TypeError, ValueError):
            page_no = 1
        fills_by_page.setdefault(page_no, []).append(f)

    reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
    writer = PyPDF2.PdfWriter()

    for idx, page in enumerate(reader.pages):
        page_no = idx + 1
        page_fills = fills_by_page.get(page_no, [])

        pw = float(page.mediabox.width)
        ph = float(page.mediabox.height)

        # Build an overlay for this page (always, even if empty, so showPage()
        # keeps page count consistent).
        packet = io.BytesIO()
        c = canvas.Canvas(packet, pagesize=(pw, ph))

        for f in page_fills:
            try:
                _draw_fill(c, f)
            except Exception as e:
                log.error(f"Failed to draw fill on page {page_no} ({f.get('label')}): {e}")

        c.showPage()   # MANDATORY — finalize the page so the overlay has 1 page
        c.save()
        packet.seek(0)

        try:
            overlay_reader = PyPDF2.PdfReader(packet)
            if len(overlay_reader.pages) > 0 and page_fills:
                page.merge_page(overlay_reader.pages[0])
        except Exception as e:
            log.error(f"Failed to merge overlay on page {page_no}: {e}")

        writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    result = out.getvalue()

    log.info(
        f"Fill plan rendered: {len(fills)} fill(s) across {len(fills_by_page)} page(s); "
        f"{len(missing_fields)} missing field(s); {len(result)} bytes"
    )
    return result, missing_fields
