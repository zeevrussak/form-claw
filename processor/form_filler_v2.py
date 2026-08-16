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

# ── Fonts ─────────────────────────────────────────────────────────────────────
# House pair, set by the owner of the form:
#   * Hebrew        -> FtPilKahol2  ("פיל כחול")
#   * English/digits-> Playzone
# Legibility is handled by SIZE, not by swapping the face: placement measures the
# blank and the renderer picks the largest size that fits it (see fill_text_field).
HEBREW_FONT_PATH = FONTS_DIR / "FtPilKahol2.ttf"
LATIN_FONT_PATH = FONTS_DIR / "Playzone.ttf"

# Neither house face covers the other's script (Playzone has no Hebrew letters,
# FtPilKahol has no Latin letters). A dual-script face is registered purely as a
# last resort for a string the chosen house font cannot render at all.
FALLBACK_FONT_CANDIDATES = [
    FONTS_DIR / "NotoSansHebrew-Regular.ttf",
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
]

# Font names as registered with ReportLab
HEBREW_FONT = "Hebrew"          # FtPilKahol2 — Hebrew field data
LATIN_FONT = "English"          # Playzone — numbers, IDs, emails, dates, English
FALLBACK_FONT = "Fallback"      # dual-script, only for uncovered glyphs
BUILTIN_FONT = "Helvetica"      # ultimate fallback, always available
# Signatures fall back to the Hebrew house face when no PNG exists.
HANDWRITING_FONT = HEBREW_FONT

# Signatures keyed by signer
_SIGNATURE_FILES = {
    "father": SIGNATURES_DIR / "zeev_signature.png",
    "mother": SIGNATURES_DIR / "keren_signature.png",
}

# Rendering constants
TARGET_FONT_SIZE = 14.0         # preferred size — used whenever the blank allows
MIN_FONT_SIZE = TARGET_FONT_SIZE   # back-compat alias (placement imports this name)
FLOOR_FONT_SIZE = 6.0           # never go below this; condense the glyphs instead
MIN_HORIZ_SCALE = 72.0          # narrowest comfortable horizontal condensation, %
ABSOLUTE_MIN_SIZE = 4.0         # hard floor when even condensing is not enough
MAX_OPTICAL_FACTOR = 2.2        # clamp on the per-face optical multiplier
BASELINE_LIFT = 2.0             # lift the baseline this many pt above fill_y
TOP_CLEARANCE = 1.5             # keep this much air between the value and the
                                # caption printed above the blank
CIRCLE_PAD = 3.0                # padding around an option word for the ellipse
CIRCLE_LINE_WIDTH = 1.3

# ── Optical size normalisation ────────────────────────────────────────────────
# FtPilKahol2 is a handwriting face: its ordinary letters (ב ר כ מ ס) top out
# around 0.30 em, while Playzone's digits reach 0.45 em. Set at the same point
# size a Hebrew name therefore looks about a third smaller than the ID number
# beside it — which is exactly what the parents table showed.
#
# So every face is measured once and given a multiplier that puts its x-height
# on a common optical baseline. All the sizing logic works in *nominal* points
# (14pt means "as big as a 14pt digit"); the multiplier is applied when the size
# is resolved, so `stringWidth` and the fitting loop still see real points.
CANONICAL_XHEIGHT = 0.46        # em — Playzone's digit height, the reference
INK_SPAN_SLACK = 1.40           # headroom over the typical letter's ink height
DEFAULT_INK_SPAN = 0.72         # used when a face cannot be measured
_XHEIGHT_SAMPLES = {
    # Flat-topped Hebrew letters — the script's true x-height set.
    True:  "בהחכמסרנפצ",
    False: "0123456789",
}

_FONTS_REGISTERED = False
_COVERAGE: dict[str, set] = {}
_OPTICAL: dict[str, float] = {}
_GLYPH_BOX: dict[str, dict] = {}
_INK_SPAN: dict[str, float] = {}


def _register(name: str, path) -> bool:
    """Register one TTF, returning True on success."""
    if name in pdfmetrics.getRegisteredFontNames():
        return True
    try:
        if not Path(path).exists():
            return False
        pdfmetrics.registerFont(TTFont(name, str(path)))
        log.info(f"font registered: {name} <- {path}")
        return True
    except Exception as e:
        log.warning(f"could not register font {name} from {path}: {e}")
        return False


def register_fonts() -> None:
    """Register the house fonts once: FtPilKahol2 (Hebrew) + Playzone (Latin)."""
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return

    if not _register(HEBREW_FONT, HEBREW_FONT_PATH):
        log.error(f"Hebrew house font missing at {HEBREW_FONT_PATH}")
    if not _register(LATIN_FONT, LATIN_FONT_PATH):
        log.error(f"Latin house font missing at {LATIN_FONT_PATH}; using Helvetica")

    for cand in FALLBACK_FONT_CANDIDATES:
        if _register(FALLBACK_FONT, cand):
            break

    _COVERAGE.clear()
    _OPTICAL.clear()
    _INK_SPAN.clear()
    _GLYPH_BOX.clear()
    for name, path, hebrew in ((HEBREW_FONT, HEBREW_FONT_PATH, True),
                               (LATIN_FONT, LATIN_FONT_PATH, False),
                               (FALLBACK_FONT, None, True)):
        _measure_face(name, path, hebrew)
    log.info("optical size factors: "
             + ", ".join(f"{n}={_OPTICAL.get(n, 1.0):.2f}"
                         for n in (HEBREW_FONT, LATIN_FONT, FALLBACK_FONT)))
    _FONTS_REGISTERED = True


def _measure_face(name: str, path, hebrew: bool) -> None:
    """Measure one registered face and cache its optical factor + ink span.

    ``_OPTICAL[name]``  nominal pt -> real pt, so the face's x-height matches
                        ``CANONICAL_XHEIGHT``.
    ``_INK_SPAN[name]`` vertical ink extent of ordinary letters, in em of the
                        *real* size — used to cap the size by the blank height
                        instead of pretending every glyph fills its em box.
    """
    if name not in pdfmetrics.getRegisteredFontNames():
        return
    tops, bottoms = [], []
    boxes: dict[int, tuple[float, float]] = {}
    try:
        from fontTools.pens.boundsPen import BoundsPen
        from fontTools.ttLib import TTFont as _FTFont

        src = path
        if src is None:                       # fallback face: whichever file took
            for cand in FALLBACK_FONT_CANDIDATES:
                if Path(cand).exists():
                    src = cand
                    break
        ft = _FTFont(str(src))
        upm = float(ft["head"].unitsPerEm) or 1000.0
        glyphs, cmap = ft.getGlyphSet(), ft.getBestCmap()
        for cp, gname in cmap.items():
            try:
                pen = BoundsPen(glyphs)
                glyphs[gname].draw(pen)
            except Exception:
                continue
            if pen.bounds:
                boxes[cp] = (pen.bounds[3] / upm, pen.bounds[1] / upm)
        for ch in _XHEIGHT_SAMPLES[hebrew]:
            box = boxes.get(ord(ch))
            if box:
                tops.append(box[0])
                bottoms.append(box[1])
    except Exception as e:                    # fontTools missing / unparsable
        log.warning(f"could not measure {name} optically ({e}); using 1.0")
    _GLYPH_BOX[name] = boxes

    if not tops:
        _OPTICAL[name], _INK_SPAN[name] = 1.0, DEFAULT_INK_SPAN
        return
    tops.sort()
    bottoms.sort()
    mid = len(tops) // 2
    xheight = tops[mid]                       # median top = the x-height
    factor = CANONICAL_XHEIGHT / xheight if xheight > 0.05 else 1.0
    factor = max(1.0 / MAX_OPTICAL_FACTOR, min(MAX_OPTICAL_FACTOR, factor))
    _OPTICAL[name] = factor
    # Typical ink span (median letter, not the one freak ascender) plus slack.
    # A handwriting ל or ן is allowed to overhang a little — clamping to the
    # extremes would shrink every value to the floor for no visual gain.
    typical = (tops[mid] - bottoms[mid]) * factor * INK_SPAN_SLACK
    _INK_SPAN[name] = max(0.35, typical)


def optical_factor(font_name: str) -> float:
    """Nominal-to-real point multiplier for a face (1.0 if never measured)."""
    return _OPTICAL.get(font_name, 1.0)


def string_extent(font_name: str, text: str) -> tuple[float, float]:
    """(top, bottom) ink extent of exactly this string, in em of the real size.

    Font-wide ascent/descent is useless here: a handwriting ן drops 0.68 em below
    the baseline while ב barely dips at all, so sizing every value against the
    worst glyph in the face would shrink everything for nothing. Measuring the
    actual characters lets a value use the whole blank when it can, and only the
    strings that really do have a long descender get pulled in.
    """
    boxes = _GLYPH_BOX.get(font_name) or {}
    if not boxes:
        return 0.72, -0.20
    tops, bots = [], []
    for ch in text:
        box = boxes.get(ord(ch))
        if box:
            tops.append(box[0])
            bots.append(box[1])
    if not tops:
        return 0.72, -0.20
    return max(tops), min(min(bots), 0.0)


def _coverage(font_name: str) -> set | None:
    """Set of code points the registered TTF can draw; None if unknown."""
    if font_name in _COVERAGE:
        return _COVERAGE[font_name] or None
    try:
        face = pdfmetrics.getFont(font_name).face
        chars = set(getattr(face, "charToGlyph", {}) or {})
    except Exception:
        chars = set()
    _COVERAGE[font_name] = chars
    return chars or None


def _covers(font_name: str, text: str) -> bool:
    """True if every non-space character of ``text`` has a glyph in the font."""
    cov = _coverage(font_name)
    if cov is None:                      # built-in / unknown: assume Latin-1
        return all(ord(ch) < 256 for ch in text)
    return all(ord(ch) in cov for ch in text if not ch.isspace())


# ── Text helpers ──────────────────────────────────────────────────────────────

def contains_hebrew(text) -> bool:
    """True if the string contains any Hebrew letter (U+0590–U+05FF)."""
    return any("\u0590" <= ch <= "\u05FF" for ch in str(text))


def shape_he(text) -> str:
    """Apply the Unicode bidi algorithm so Hebrew letters render RTL while any
    embedded digit / Latin runs keep their natural left-to-right order."""
    return get_display(str(text))


def _pick_font(text, is_hebrew: bool | None) -> str:
    """Choose the house font by actual content, then verify glyph coverage.

    Hebrew letters -> FtPilKahol2; digits / Latin / symbols -> Playzone. If the
    chosen face is missing a glyph in this particular string (a Hebrew name with
    a Latin initial, say) we step down to a face that can draw it rather than
    emitting blank boxes.
    """
    if not _FONTS_REGISTERED:
        register_fonts()
    if is_hebrew is None:
        is_hebrew = contains_hebrew(text)
    # Even if flagged Hebrew, only use the Hebrew font when Hebrew letters are
    # actually present — protects against boxes for pure-numeric values.
    primary = HEBREW_FONT if (is_hebrew and contains_hebrew(text)) else LATIN_FONT
    other = LATIN_FONT if primary == HEBREW_FONT else HEBREW_FONT
    for name in (primary, other, FALLBACK_FONT, BUILTIN_FONT):
        try:
            if name in pdfmetrics.getRegisteredFontNames() and _covers(name, str(text)):
                if name != primary:
                    log.warning(f"font {primary} lacks glyphs for {text!r}; using {name}")
                return name
        except Exception:
            continue
    return primary


# ── Field renderers ────────────────────────────────────────────────────────────

def fit_font_size(c, draw_str: str, font: str, width: float, height: float,
                  start: float = TARGET_FONT_SIZE) -> tuple[float, float]:
    """Largest size (and horizontal scale) at which ``draw_str`` fits the blank.

    Tight blanks must never be reported as a problem — they must be *made* to
    fit. The value is shrunk until it fits the measured width, and only if it is
    still too wide at the floor size are the glyphs condensed horizontally.

    ``start`` is a *nominal* size; the return value is the real point size to
    hand to ``setFont`` — already multiplied by the face's optical factor, so a
    handwriting Hebrew face comes out visually the same height as a digit.

    Returns (font_size, horiz_scale_percent).
    """
    factor = optical_factor(font)
    top, bottom = string_extent(font, draw_str)
    ink = max(0.25, top - bottom)
    size = float(start or TARGET_FONT_SIZE) * factor
    floor = FLOOR_FONT_SIZE * factor
    # A blank shorter than the glyphs would let the value climb into the caption
    # printed above it (or drop through the rule below) — so cap against the ink
    # this exact string puts on the page, not against the nominal em box.
    if height and height > 1.0:
        # The baseline is lifted off the bottom rule, so that lift comes out of
        # the blank's height before the glyphs get to use it.
        usable = max(1.0, height - BASELINE_LIFT - TOP_CLEARANCE)
        size = min(size, max(floor, usable / ink))
    if not width or width <= 0:
        return size, 100.0

    while size > floor and c.stringWidth(draw_str, font, size) > width:
        size -= 0.25

    w = c.stringWidth(draw_str, font, size)
    if w > width > 0:
        # Already at the floor: condense rather than overflow into the next cell.
        scale = 100.0 * width / w
        if scale < MIN_HORIZ_SCALE:
            # Condensing alone would squash the glyphs past readability, so give
            # up the floor size too. Spilling across a cell rule is worse than a
            # small value: the blank is what it is, the value has to fit in it.
            size = max(ABSOLUTE_MIN_SIZE, size * scale / MIN_HORIZ_SCALE)
            w = c.stringWidth(draw_str, font, size)
            scale = max(MIN_HORIZ_SCALE, 100.0 * width / w) if w > width else 100.0
            log.warning(f"blank is only {width:.0f}pt wide for a "
                        f"{len(draw_str)}-character value; dropped below the "
                        f"floor to {size:.1f}pt at {scale:.0f}% to keep it inside")
        return size, max(MIN_HORIZ_SCALE * 0.6, scale)
    return size, 100.0


def fill_text_field(c, x, y, width, height, text, anchor="right",
                    is_hebrew=None, font_size=None, min_size=None):
    """Draw a text value inside a blank field, sized to fit that blank.

    ``font_size`` is the size placement asked for (it already measured the cell);
    it is treated as a starting point and reduced further if the string still
    does not fit. The baseline is lifted a couple points above ``y`` so letters
    rest on the underline / cell rule.
    """
    if text is None or str(text).strip() == "":
        return
    text = str(text)

    font = _pick_font(text, is_hebrew)
    draw_str = shape_he(text) if font == HEBREW_FONT else text

    start = font_size or min_size or TARGET_FONT_SIZE
    size, hscale = fit_font_size(c, draw_str, font, width, height, start)

    # Lift the baseline so a descender (ן, ץ, ק, a comma) stays inside the blank
    # instead of striking through the cell rule under it.
    _, bottom = string_extent(font, draw_str)
    baseline = y + BASELINE_LIFT + max(0.0, -bottom) * size

    if hscale == 100.0:
        c.setFont(font, size)
        if anchor == "right":
            c.drawRightString(x, baseline, draw_str)
        elif anchor == "center":
            cx = x + (width / 2.0 if width else 0)
            c.drawCentredString(cx, baseline, draw_str)
        else:  # "left"
            c.drawString(x, baseline, draw_str)
        return

    # Condensed: reportlab only exposes horizontal scaling on a text object.
    eff_w = c.stringWidth(draw_str, font, size) * hscale / 100.0
    if anchor == "right":
        start_x = x - eff_w
    elif anchor == "center":
        start_x = x + (width / 2.0 if width else 0) - eff_w / 2.0
    else:
        start_x = x
    log.info(f"condensed {text!r} to {hscale:.0f}% at {size:.1f}pt "
             f"to fit a {width:.0f}pt blank")
    tx = c.beginText()
    tx.setFont(font, size)
    tx.setHorizScale(hscale)
    tx.setTextOrigin(start_x, baseline)
    tx.textOut(draw_str)
    c.drawText(tx)


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
    factor = optical_factor(LATIN_FONT)
    floor = FLOOR_FONT_SIZE * factor
    size = TARGET_FONT_SIZE * factor
    if height and height > 1.0:
        size = min(size, max(floor, height * 0.95 / _INK_SPAN.get(LATIN_FONT, DEFAULT_INK_SPAN)))
    # keep each digit inside its own box
    if box_width:
        while size > floor and c.stringWidth("0", LATIN_FONT, size) > box_width * 0.8:
            size -= 0.25
    c.setFont(LATIN_FONT, size)
    baseline = y + BASELINE_LIFT

    # First digit -> rightmost box. Digit i (0-based, LTR order) goes into the
    # box counted from the right: center x = x_left + total_width - (i+0.5)*box_width
    for i, digit in enumerate(digits[:n_boxes]):
        center_x = x_left + total_width - (i + 0.5) * box_width
        c.drawCentredString(center_x, baseline, digit)


def fill_checkbox(c, x, y, width, height):
    """Draw a check mark centered in a checkbox."""
    factor = optical_factor(LATIN_FONT)
    size = min(height * 0.9, TARGET_FONT_SIZE * factor) if height else TARGET_FONT_SIZE * factor
    size = max(size, FLOOR_FONT_SIZE * factor)
    tick_font = LATIN_FONT if _covers(LATIN_FONT, "\u2713") else BUILTIN_FONT
    c.setFont(tick_font, size)
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
    y1 = y + (height or TARGET_FONT_SIZE) + CIRCLE_PAD
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
    # Size chosen by the placement step after measuring the real blank. Absent
    # (plan came straight from the LLM) we start at the target size.
    try:
        font_size = float(fill.get("font_size") or 0) or None
    except (TypeError, ValueError):
        font_size = None

    if ftype == "id_digits":
        fill_id_boxes(c, x, y, width, height, value)
    elif ftype == "checkbox":
        fill_checkbox(c, x, y, width, height)
    elif ftype in ("circle_option", "radio"):
        fill_circle_option(c, x, y, width, height)
    elif ftype == "signature":
        fill_signature(c, x, y, width, height, value)
    elif ftype in _TEXT_TYPES:
        fill_text_field(c, x, y, width, height, value, anchor=anchor,
                        is_hebrew=is_hebrew, font_size=font_size)
    else:
        # Unknown type: best-effort as text if there is a value.
        if value not in (None, ""):
            fill_text_field(c, x, y, width, height, value, anchor=anchor,
                            is_hebrew=is_hebrew, font_size=font_size)


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
