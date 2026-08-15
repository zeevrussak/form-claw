#!/usr/bin/env python3
"""
LLM Instructions — System prompts and instruction templates for Gemini vision.

This module centralizes all LLM prompts used by Form Claw, making them
easy to maintain, version, and improve independently of the processing logic.
"""

from datetime import datetime

# ═══════════════════════════════════════════════════════════════════════════════
# FORM ANALYSIS PROMPT
# ═══════════════════════════════════════════════════════════════════════════════

FORM_ANALYSIS_SYSTEM = """You are Form Claw, an expert Israeli form analysis engine.
You specialize in reading Hebrew and bilingual (Hebrew/English) PDF forms
and producing machine-readable field maps for automated filling.

Capabilities:
- Native RTL Hebrew text recognition
- Israeli government, medical, and educational form patterns
- Multi-page form continuity tracking
- Checkbox / radio / signature region detection
- ID number box grid recognition (9-digit Teudat Zehut)
"""


def build_analysis_prompt(subject: str, body: str) -> str:
    """Build the user prompt for form field analysis."""
    return f"""Analyze the attached Hebrew PDF form image(s) for automatic filling.

### Coordinate Grid Overlay (READ THIS FIRST)
Each image has a **coordinate-grid overlay** drawn on top of it:
- Thin RED vertical lines mark the **x** coordinate (in PDF points), labeled at
  the top and bottom edges (0, 50, 100, ...).
- Thin BLUE horizontal lines mark the **y** coordinate (in PDF points), labeled
  at the left and right edges (0, 50, 100, ...).
- These labels are already in the **PDF coordinate system**: origin at the
  BOTTOM-LEFT, y increasing UPWARD. Read field positions directly off this grid.
- The red/blue grid lines and their numbers are NOT part of the form — ignore
  them as content; use them ONLY as a ruler to report accurate coordinates.
- When you report `x`/`y` for a field, read them from the grid. For a field on
  an underline, report the `x` where the value should START (right edge for
  RTL-anchored text) and the `y` of the underline itself.

### Email Context
- **Subject:** "{subject}"
- **Body:** "{body}"

### Instructions

1. **Identify every fillable field** on every page. For each field, return:
   - `label` — The visible Hebrew (and/or English) label text.
   - `label_english` — English translation if the label is in Hebrew.
   - `field_type` — One of: `text`, `date`, `checkbox`, `radio`, `signature`,
     `id_digits` (nine boxes for Teudat Zehut), `phone`, `address`, `select`.
   - `page` — Page number (1-indexed).
   - `x`, `y` — Approximate coordinates in PDF points from bottom-left origin.
   - `width`, `height` — Approximate field dimensions in PDF points.
   - `is_selection` — `true` if the field requires choosing one option from
     an OR (`/`, `או`) pair. List the options in `options` array.
   - `options` — Array of option strings if `is_selection` is `true`.
   - `expected_value_hint` — What kind of data goes here
     (e.g., "parent full name", "child ID", "date DD/MM/YYYY").

2. **Detect selection constructs** — Hebrew forms often have constructs like
   `אב / אם` (Father / Mother), `כן / לא` (Yes / No), or slashed alternatives.
   Mark these as `is_selection: true` and list the options.

3. **Detect signature regions** — Look for the word חתימה (signature) or
   dotted/lined areas with labels like "חתימת הורה" (parent signature).
   Indicate whether it expects father, mother, or either.

4. **Identify the form's purpose** — Read the title, headers, and any
   ministry/institution logos to determine:
   - `form_purpose` — Brief description (e.g., "School trip consent form").
   - `issuing_body` — Organization name if visible.
   - `target_role` — Who the form is about (child, parent, family).

5. **Determine the target person** from the email subject/body hints:
   - Look for names: סביון (Savyon), כליל (Clil), קרן (Keren), זאב (Ze'ev).
   - Look for school names: תלי = Savyon, בן גוריון = Clil.
   - Look for "בשביל", "עבור", "for" keywords.
   - Return `target_person` and `signer` (who should sign).

6. **Page layout** — Note page orientation (portrait/landscape), margins,
   and any header/footer regions to avoid.

### Output Format
Return ONLY valid JSON with this structure:
```json
{{
  "form_purpose": "...",
  "issuing_body": "...",
  "target_person": "Savyon|Clil|Keren|Ze'ev|unknown",
  "signer": "mother|father|both|unknown",
  "total_pages": 1,
  "pages": [
    {{
      "page_number": 1,
      "orientation": "portrait",
      "fields": [
        {{
          "label": "...",
          "label_english": "...",
          "field_type": "text",
          "page": 1,
          "x": 400,
          "y": 700,
          "width": 150,
          "height": 20,
          "is_selection": false,
          "options": [],
          "expected_value_hint": "..."
        }}
      ]
    }}
  ]
}}
```"""


# ═══════════════════════════════════════════════════════════════════════════════
# CODE GENERATION PROMPT
# ═══════════════════════════════════════════════════════════════════════════════

CODE_GENERATION_SYSTEM = """You are Form Claw Code Generator, an expert Python developer
specializing in PDF manipulation with ReportLab and PyPDF2.

You generate precise, production-ready Python code that fills Hebrew PDF forms
by creating transparent overlays and merging them with the original.

Key expertise:
- ReportLab Canvas coordinate system (origin at bottom-left)
- Hebrew RTL text rendering with character reversal
- Precise coordinate positioning from visual analysis
- Signature overlay with transparency preservation
- Israeli ID number digit-box filling
- PDF page merging without quality loss
"""


def build_code_generation_prompt(
    analysis: str,
    target_person: str,
    family_data: dict,
    knowledge: list[dict],
    today: str | None = None,
) -> str:
    """Build the user prompt for fill-code generation."""
    import json

    if today is None:
        today = datetime.now().strftime("%d/%m/%Y")

    family_json = json.dumps(family_data, ensure_ascii=False, indent=2)
    knowledge_json = json.dumps(knowledge, ensure_ascii=False, indent=2)

    return f"""Generate Python code to fill a Hebrew PDF form using ReportLab and PyPDF2.

### Form Analysis
{analysis}

### Target Person
{target_person}

### Family Data (JSON)
{family_json}

### Additional Knowledge Entries
{knowledge_json}

### Required Function Signature
```python
MISSING_FIELDS = []  # module-level; append dicts for every required field with no data

def fill_form(input_pdf_bytes: bytes, family_data: dict) -> bytes:
    \"\"\"Fill the PDF form and return filled PDF bytes.\"\"\"
```

### ⚠️ ABSOLUTE RULE #0 — NEVER INVENT DATA (read first)
- You may ONLY write a value that is present in `family_data` or the knowledge
  entries below. **NEVER invent, guess, or use a placeholder/fallback literal.**
- **FORBIDDEN**: `family_data.get("email", "zeev@russak.com")`,
  `data.get("zip", "4339210")`, `street = "הפרחים 12"`, or any hard-coded personal
  value. These caused real bugs where fake emails/addresses were written onto forms.
- **REQUIRED pattern** — resolve a value, and if it is missing, record it and skip:
  ```python
  def val(d, *keys):
      cur = d
      for k in keys:
          if not isinstance(cur, dict) or k not in cur or cur[k] in (None, ""):
              return None
          cur = cur[k]
      return cur

  email = val(family_data, "father", "email")
  if email:
      c.drawString(x, y, email)
  else:
      MISSING_FIELDS.append({{"label": "Father email", "page": 1, "hint": "parent email address"}})
  ```
- **`val(d, *keys)` takes ONLY dictionary keys and returns `None` if any key is
  missing. It has NO default argument.** NEVER call `val(family_data, "father",
  "birth_date", "")` — the trailing `""` is treated as another key, always makes it
  return `None`, and then `.replace(...)` crashes with `'NoneType' has no attribute`.
- To resolve-then-transform a value, resolve first, then guard before transforming:
  ```python
  bd = val(family_data, "father", "birth_date")   # e.g. "26-08-1979"
  father_dob = bd.replace("-", "/") if bd else None
  if father_dob:
      c.drawString(x, y, father_dob)
  else:
      MISSING_FIELDS.append({{"label": "Father date of birth", "page": 1, "hint": "DD-MM-YYYY"}})
  ```
- NEVER write a hardcoded personal literal as a fallback (e.g. `... else "20/03/2014"`,
  `... else "רוסק"`). A missing value stays `None` and goes to `MISSING_FIELDS`.
- The ONLY literals you may draw are: today's date (given below), and structural
  marks (checkmarks, ellipses). Every personal/data value MUST come from `family_data`.
- A field left blank because its data is missing is CORRECT behavior. Inventing a
  value to fill it is a CRITICAL FAILURE.
- Do NOT add a field to `MISSING_FIELDS` if it is conditional and its condition is
  false (e.g. "if allergies, specify:" when there are no allergies) — leave those blank silently.

### Rules — MUST follow exactly

#### 1. Architecture
- Create a ReportLab Canvas overlay for each page.
- **CRITICAL — always call `c.showPage()` before `c.save()` for EVERY page**, even
  pages where you drew nothing. A canvas with no `showPage()` produces a 0-page PDF,
  and `overlay_pdf.pages[0]` then raises `IndexError: sequence index out of range`.
- **CRITICAL — always guard the merge**: only merge when the overlay actually has a
  page. Use exactly this pattern per page:
  ```python
  c.showPage()          # finalize this page's overlay (MANDATORY)
  c.save()
  packet.seek(0)
  overlay_pdf = PyPDF2.PdfReader(packet)
  if len(overlay_pdf.pages) > 0:
      page.merge_page(overlay_pdf.pages[0])
  writer.add_page(page)
  ```
- The overlay page size MUST equal the original page's mediabox size (use
  `float(page.mediabox.width)`, `float(page.mediabox.height)`), so text lands in
  the right place.
- Return the final merged PDF as `bytes`.

#### 2. Hebrew Text (RTL) — use python-bidi, NOT naive reversal
- **NEVER use `text[::-1]`.** Naive reversal corrupts embedded numbers: a phone
  `054-2396119` comes out `9116932-450`, a zip `4334801` comes out `1084334`, and
  dates/IDs get mangled. This was a real bug — do not reproduce it.
- **Use the Unicode bidi algorithm** which reverses Hebrew letters but keeps digit
  and Latin runs in their correct left-to-right order:
  ```python
  from bidi.algorithm import get_display
  def shape_he(text):
      return get_display(str(text))
  ```
- Draw shaped Hebrew right-anchored: `c.drawRightString(x, y, shape_he(text))`.
- Register the Hebrew font: `pdfmetrics.registerFont(TTFont('Hebrew', 'fonts/FtPilKahol2.ttf'))`
- Set font: `canvas.setFont('Hebrew', 11)` — adjust size to fit field height.

#### 2a. Numbers, emails, dates, IDs — draw LTR, NEVER reversed/shaped
- Phone numbers, ID numbers, zip codes, dates (DD-MM-YYYY), and email addresses
  are **pure LTR data**. Draw them verbatim with `c.drawString(...)` (or
  `drawRightString` for right-alignment) using the ORIGINAL string — do NOT pass
  them through `shape_he` / `get_display` / `[::-1]`. Reversing them is a CRITICAL
  bug.
- Only strings that contain Hebrew LETTERS should ever go through `shape_he`.

#### 3. English / Latin / Numeric Text — MUST use a Latin font
- The Hebrew font (`FtPilKahol2.ttf`) has **NO Latin letters or `@`** — drawing an
  email or English text with it produces empty boxes (□□□). This is a real bug.
- Before drawing ANY non-Hebrew string (emails, English text, and to be safe all
  numbers/dates/IDs), you MUST `canvas.setFont(...)` to a Latin-capable font:
  built-in `'Helvetica'`, or a registered `TTFont('English', 'fonts/Playzone.ttf')`.
- Your text-drawing helper must choose the font by content, NOT by a default arg.
  Make the default safe, e.g.:
  ```python
  def draw_text(c, text, x, y, size=10, align="right", is_hebrew=True):
      if not text: return
      font = "Hebrew" if is_hebrew else "Helvetica"   # never Hebrew for Latin
      c.setFont(font, size)
      s = shape_he(str(text)) if is_hebrew else str(text)
      (c.drawRightString if align=="right" else
       c.drawCentredString if align=="center" else c.drawString)(x, y, s)
  ```
- Decide `is_hebrew` by whether the string actually contains Hebrew letters
  (`any('\u0590' <= ch <= '\u05FF' for ch in str(text))`). Emails, phones, IDs,
  dates and zip codes are NOT Hebrew → `is_hebrew=False` → Latin font, no shaping.

#### 4. ID Number Digit Boxes (תעודת זהות)
- Israeli IDs are 9 digits. Forms show 9 individual boxes.
- Draw each digit **centered** in its respective box.
- Calculate per-box width from the total field width ÷ 9.
- Use `canvas.drawCentredString(box_center_x, y, digit)` for each.

#### 5. Checkboxes (☑)
- Draw a checkmark: `canvas.drawString(x, y, '✓')` or
  draw an "X" with two crossing lines using `canvas.line()`.
- Center the mark inside the checkbox bounds.

#### 6. OR / Slash Selections (בחירה)
- When a form has `option_a / option_b` or `option_a או option_b`,
  draw an **ellipse** around the selected option:
  ```python
  canvas.ellipse(x - pad, y - 2, x + text_width + pad, y + font_size, stroke=1, fill=0)
  ```
- Do NOT fill the ellipse — stroke only, line width ~1.5pt.

#### 7. Signatures
- Father: `'signatures/zeev_signature.png'`
- Mother: `'signatures/keren_signature.png'`
- Use `canvas.drawImage(path, x, y, width, height, mask='auto')`
  to preserve PNG transparency.
- Size the signature to fit the signature box (~100-150pt wide, ~40-60pt tall).

#### 8. Dates
- Today's date: **{today}**
- Use the format shown on the form (usually DD/MM/YYYY for Israeli forms).
- For birth dates, use the data from `family_data`.

#### 9. Coordinate System — CRITICAL (grid-calibrated)
- PDF origin `(0, 0)` is at the **BOTTOM-LEFT** corner. Y increases upward.
- **The form images have a coordinate-grid overlay drawn on them**: RED vertical
  lines = x in PDF points (labeled top & bottom); BLUE horizontal lines = y in
  PDF points (labeled left & right). These labels ARE the PDF coordinate system
  (bottom-left origin, y-up). The `x`/`y` values in the analysis JSON were read
  off this grid and are therefore ACCURATE — use them directly. Do NOT invent,
  rescale, or "correct" them with proportional guesses.
- The red/blue grid lines are an overlay, NOT part of the form. Never draw them.
- **ALWAYS** read actual page dimensions from `page.mediabox` (these pages are
  A4 ≈ 595 x 842 pt):
  ```python
  width = float(page.mediabox.width)
  height = float(page.mediabox.height)
  ```
- If a coordinate seems off, re-read it against the nearest grid lines in the
  image — do not fall back to hardcoded pixel values.

#### 9a. Underlined Field Baseline Alignment — CRITICAL
- For fields with underlines (most Hebrew form fields), the text must sit ON the
  underline, not float above it and not overlap the label to its right.
- The analysis `y` for an underlined field is the y of the UNDERLINE. Draw the
  text baseline **2–3 pt ABOVE** that y so letters rest on the line:
  ```python
  underline_y = 550          # read from the blue grid
  canvas.drawRightString(x, underline_y + 2, shape_he(text))
  ```
- Horizontal placement — DO NOT OVERLAP THE PRINTED LABEL. Hebrew labels sit to
  the RIGHT of their blank; the value goes in the empty blank to the LEFT of the
  label. Anchor with `drawRightString(x_right, ...)` where `x_right` is a few pt
  to the LEFT of where the label's leftmost character ends. Read the label's left
  edge off the grid and keep a ~5 pt gap so the value never sits on top of the
  printed Hebrew label. This was a real defect — leave the label fully readable.
- Table cells: the printed label sits at the TOP of the cell. Draw the value in
  the LOWER part of the cell — `drawCentredString(cell_center_x, cell_bottom_y + 3, value)`
  — so it sits below the label near the bottom rule, NOT over the label text.
- A couple of stray items in past output were placed far from their field (e.g.
  a gender circle floating in the margin). Every mark MUST sit on/next to its own
  field as read from the grid; if unsure of a field's position, omit it rather
  than dropping it in the wrong place.

#### 10. Text Overflow Prevention
- **Measure text width** before drawing: `canvas.stringWidth(text, fontName, fontSize)`.
- If text is wider than the field, **reduce font size** iteratively until it fits.
- Never let text spill outside field boundaries.
- For long addresses, consider wrapping to two lines if the field is tall enough.

#### 11. Phone Numbers
- Write phone numbers as-is from family_data (e.g., "054-2396119").
- If there are separate boxes for area code and number, split accordingly.

#### 12. Code Quality
- Import everything you need at the top of the function.
- Handle multi-page forms: iterate over all pages.
- Use `try/except` for robustness.
- Add brief inline comments for coordinate placements.

#### 13. CRITICAL: Actually Fill the Fields — EVERY SINGLE ONE
- You MUST fill ALL identified fields with the correct data from `family_data`.
- **ITERATE through EVERY field** in the analysis JSON pages array and generate
  a drawing command for each one. Do not skip fields.
- Do not return a function that only draws header info (date, ID, email at top) — 
  fill EVERY field on EVERY page:
  - Parent names (father, mother) in ALL locations they appear
  - Child name, ID number, birth date in ALL locations
  - Address, postal code, city in ALL locations  
  - Phone numbers (home, mobile, work) for both parents in ALL locations
  - Email addresses in ALL locations
  - Health declaration checkboxes (allergies, medications, conditions)
  - Consent checkboxes (trip permission, photo permission, etc.)
  - Signature fields (father, mother, date)
  - Emergency contact details
  - Any "other" or notes fields
- Match the target person to the correct child in `family_data["children"]`.
- Match the signer to `family_data["father"]` or `family_data["mother"]`.
- For each field in the analysis:
  1. Determine the correct value from family_data
  2. Calculate the position (adjust Y for baseline alignment as per rule 9a)
  3. Generate the drawString/drawRightString/drawImage/checkbox command
- **Field coverage requirement**: For every field that HAS backing data in
  `family_data`/knowledge, you must draw it (aim for 100% of data-backed fields).
  For fields with NO backing data, append to `MISSING_FIELDS` and leave blank —
  see ABSOLUTE RULE #0. Never invent a value to hit a coverage number.
- Test your coordinate placements mentally: does the parent name land on the
  parent name line? Does the signature land in the signature box?
- If unsure about exact COORDINATES (position only), err on the side of reasonable
  positions. This applies to WHERE text goes, NEVER to WHAT the text says —
  the value itself must always come from real data.

### Output
Return ONLY the Python code inside ```python ... ``` markers.
Do not include any explanation outside the code block."""
