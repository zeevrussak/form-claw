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
def fill_form(input_pdf_bytes: bytes, family_data: dict) -> bytes:
    \"\"\"Fill the PDF form and return filled PDF bytes.\"\"\"
```

### Rules — MUST follow exactly

#### 1. Architecture
- Create a ReportLab Canvas overlay for each page.
- Merge each overlay with the original page using PyPDF2's `PageObject.merge_page()`.
- Return the final merged PDF as `bytes`.

#### 2. Hebrew Text (RTL)
- **Always reverse** Hebrew strings before drawing: `text[::-1]`.
- Use `canvas.drawRightString(x, y, reversed_text)` for Hebrew — this anchors
  at the RIGHT edge of the field, which is the START in RTL.
- Register the Hebrew font: `pdfmetrics.registerFont(TTFont('Hebrew', 'fonts/FtPilKahol2.ttf'))`
- Set font: `canvas.setFont('Hebrew', 11)` — adjust size to fit field height.
- For mixed Hebrew/English content, draw each segment separately.

#### 3. English Text
- Use `canvas.drawString(x, y, text)` (left-anchored).
- Font: either built-in `Helvetica` or register `TTFont('English', 'fonts/Playzone.ttf')`.

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

#### 9. Coordinate System — CRITICAL
- PDF origin `(0, 0)` is at the **BOTTOM-LEFT** corner.
- Y increases upward. Page tops are typically ~842pt (A4) or ~792pt (Letter).
- **ALWAYS** read actual page dimensions from `page.mediabox`:
  ```python
  width = float(page.mediabox.width)
  height = float(page.mediabox.height)
  ```
- The images you see may not be the same resolution as the PDF. The coordinates in the
  analysis JSON are APPROXIMATE. You must:
  1. Read the actual page dimensions from `page.mediabox`.
  2. Position fields relative to the page dimensions, NOT from hardcoded pixel values.
  3. For image-sourced PDFs, the page size equals the image size in pixels at 72 DPI.
     An A4-like image (e.g., ~595x842pt) is typical.
  4. Use proportional positioning when possible:
     `x = width * 0.75` for a field 75% from the left.
- If coordinates from analysis look wrong, use visual landmarks from the form
  (headers, section breaks) to estimate correct positions.

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

#### 13. CRITICAL: Actually Fill the Fields
- You MUST fill ALL identified fields with the correct data from `family_data`.
- Do not return a function that only draws a date — fill EVERY field:
  parent name, child name, ID number, address, phone, signature, checkboxes, etc.
- Match the target person to the correct child in `family_data["children"]`.
- Match the signer to `family_data["father"]` or `family_data["mother"]`.
- For each field, determine the correct value from family_data and draw it.
- Test your coordinate placements mentally: does the parent name land on the
  parent name line? Does the signature land in the signature box?
- If unsure about exact coordinates, err on the side of reasonable positions
  rather than leaving fields empty.

### Output
Return ONLY the Python code inside ```python ... ``` markers.
Do not include any explanation outside the code block."""
