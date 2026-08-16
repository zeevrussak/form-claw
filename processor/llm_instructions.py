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

### Email Context
- **Subject:** "{subject}"
- **Body:** "{body}"

### YOUR JOB: locate the BLANK FILL AREA of every field
For each field you must return the coordinates of the **empty space where the
value should be written** — NOT the coordinates of the printed label.

#### Hebrew layout rules (CRITICAL — these were violated before)
1. Hebrew reads RIGHT-TO-LEFT. A label like `שם פרטי:` sits at the RIGHT of its
   blank; the value is written in the empty space to the **LEFT** of the label
   (or in the cell area BELOW the label in a table). The value NEVER goes to the
   right of the label text.
2. An **empty underline** to the left of, or below, a label is THE fill target.
   Report the underline's position.
3. In a **table cell**: the label is printed at the TOP-RIGHT of the cell; the
   fill area is the empty part of the cell (to the left of the label and/or the
   lower portion of the cell). Put the value there — never on top of the label.
4. `fill_x`/`fill_y` = the blank fill area, positioned so the value will not
   overlap the printed label.

#### For every field return these fill-target coordinates
- `label` — visible Hebrew (and/or English) label text.
- `label_english` — English translation of the label.
- `field_type` — one of: `text`, `date`, `checkbox`, `radio`, `signature`,
  `id_digits` (the 9-box Teudat Zehut grid), `phone`, `email`, `address`, `select`.
- `page` — page number (1-indexed).
- `fill_x` — x of the fill area. For RTL Hebrew text: the **RIGHT edge** of the
  blank space (where right-anchored text starts). For LTR data and centered
  boxes: the LEFT edge of the blank space.
- `fill_y` — y of the underline / bottom of the blank cell (the baseline the
  text should sit on).
- `fill_width` — width of the blank space in points (from its left wall to its
  right edge). Used to auto-fit long values and to center digit boxes.
- `fill_height` — height of the blank space / cell in points.
- `fill_anchor` — `"right"` for Hebrew text (RTL), `"left"` for LTR data
  (numbers, IDs, emails, dates, phones), `"center"` for id_digits / checkboxes /
  radio circles.
- `is_hebrew` — `true` if the VALUE that goes here will be Hebrew letters;
  `false` for numbers, IDs, dates, emails, phones.
- `is_selection` — `true` if the field is an OR choice (`/`, `או`) pair.
- `options` — for a selection, an array of objects
  `{{"text": "...", "x": <center x>, "y": <baseline y>, "width": <pts>, "height": <pts>}}`
  giving the position of EACH option word so a circle can be drawn around the
  chosen one. Empty array otherwise.
- `label_bbox` — `[x0, y0, x1, y1]` bounding box of the **printed label text
  itself** (not the fill area). REQUIRED for every field. A downstream
  measurement step uses this to find the real blank next to the label, so give
  it as tightly as you can: only the caption glyphs, excluding the colon's
  trailing whitespace and excluding any ruled line.
- `fill_placement` — where the value must go RELATIVE TO THE LABEL. One of:
  - `in_box` — same box/cell as the label, in its empty part (the normal case
    for a bordered table cell whose caption sits at the top-right).
  - `left_of_label` — on the ruled blank that continues to the LEFT of the
    label on the same line (`label: ______`). The normal case for Hebrew
    free-text lines.
  - `below_label` — on the ruled blank directly UNDER the label.
  - `above_label` — only when the blank is genuinely above the caption.
  - `right_of_label` — **FORBIDDEN for Hebrew fields.** Hebrew reads
    right-to-left, so the space to the right of a Hebrew caption belongs to the
    previous field; writing there collides with it. Use this ONLY for a
    left-to-right caption on an English form.
- `expected_value_hint` — specific description of the data
  (e.g. "child first name", "child ID number (9 digits)", "postal code / zip",
  "city / town", "neighborhood", "father mobile phone", "date DD/MM/YYYY").

#### Field-type specifics
- **id_digits**: the 9-box ת"ז grid. Set `fill_anchor:"center"`, `fill_x` = LEFT
  edge of the whole grid, `fill_width` = total width of all 9 boxes together.
- **radio / selection** (e.g. `ז / נ`, `אב / אם`, `כן / לא`): set
  `is_selection:true` and fill `options` with each option's own position.
- **signature**: look for חתימה / חתימת הורה. Note whether father/mother/either.
- **מיקוד** = postal/zip code — a DISTINCT field from **ישוב**/**עיר** (city).
  Keep their fill areas separate; never merge them.
- **שכונה** = neighborhood — its own field.

#### Repeated blocks (parents table)
A parents table prints the SAME panel of captions twice, side by side (two
blocks headed הורה). Report EVERY copy as its own field with its OWN
`label_bbox` — do not collapse the two copies into one field. Give the two
copies different `field_id`s and mark which side each is on, e.g.
`"parent_right_first_name"` / `"parent_left_first_name"`. The captions to expect
in each panel are שם פרטי, מספר ת"ז, ארץ לידה, תאריך לידה, מקום עבודה, עיסוק,
טלפון בעבודה, טלפון נייד, כתובת אלקטרונית, מצב משפחתי. Missing one copy of a
caption means one parent's cell can never be filled.

### Identify the form + target person
- `form_purpose` — brief description; `issuing_body` — organization if visible.
- `target_person` from subject/body/name hints: סביון (Savyon), כליל (Clil),
  קרן (Keren), זאב (Ze'ev). School: תלי = Savyon, בן גוריון = Clil.
- `signer` — who should sign (mother/father/both).

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
          "label": "שם פרטי",
          "label_english": "first name",
          "field_type": "text",
          "page": 1,
          "fill_x": 780,
          "fill_y": 552,
          "fill_width": 120,
          "fill_height": 22,
          "fill_anchor": "right",
          "is_hebrew": true,
          "is_selection": false,
          "options": [],
          "label_bbox": [900, 548, 962, 566],
          "fill_placement": "in_box",
          "expected_value_hint": "child first name"
        }}
      ]
    }}
  ]
}}
```"""


# ═══════════════════════════════════════════════════════════════════════════════
# FILL PLAN PROMPT  (NEW — replaces code generation)
# ═══════════════════════════════════════════════════════════════════════════════

FILL_PLAN_SYSTEM = """You are Form Claw Fill Planner. Given a form field analysis
(with fill-area coordinates) and a family's data, you decide WHAT VALUE goes in
each field and produce a machine-readable JSON fill plan.

You do NOT write code and you do NOT compute positions — the coordinates are
already provided in the analysis. Your only job is mapping the right data value
to each field, or marking it missing when no data exists.

Absolute rule: NEVER invent, guess, or use a placeholder value. Only use values
that are actually present in the provided family data / knowledge. If a required
field has no backing value, put it in `missing_fields` and leave it out of
`fills`. A blank field is correct; an invented value is a critical failure."""


def build_fill_plan_prompt(
    analysis: str,
    target_person: str,
    family_data: dict,
    knowledge: list[dict],
    today: str | None = None,
) -> str:
    """Build the user prompt that asks Gemini for a JSON fill plan (no code)."""
    import json

    if today is None:
        today = datetime.now().strftime("%d/%m/%Y")

    family_json = json.dumps(family_data, ensure_ascii=False, indent=2)
    knowledge_json = json.dumps(knowledge, ensure_ascii=False, indent=2)

    return f"""Produce a JSON fill plan for this Hebrew form. NO code, NO explanation.

### Form Analysis (fields with fill-area coordinates)
{analysis}

### Target Person
{target_person}

### Family Data (JSON) — the ONLY source of values
{family_json}

### Additional Knowledge Entries
{knowledge_json}

### Today's date
{today}

### What to produce
For EVERY field in the analysis, decide the correct value from the family data
and emit one entry in `fills`, OR — if there is no backing value — add it to
`missing_fields` and do NOT emit a fill for it.

Copy the geometry (`fill_x`, `fill_y`, `fill_width`, `fill_height`,
`fill_anchor`, `page`, `field_type`, **`label_bbox`**, **`fill_placement`**)
straight from the analysis into each fill. Do not recompute or "correct" them.

`label_bbox` and `fill_placement` are MANDATORY on every text-like fill. After
you return this plan, a deterministic placement step measures the actual page
(ruled lines, table cells, pre-printed ink) and uses `label_bbox` to find the
real blank; `fill_x/fill_y/fill_width/fill_height` are treated only as a hint
and may be overridden. A fill with no `label_bbox` cannot be corrected, so if
its coordinates are wrong the value is dropped rather than drawn in the wrong
place. Never emit `fill_placement: "right_of_label"` for a Hebrew field.

### Value mapping rules
- Match the child to the correct entry in `family_data["children"]` using
  `target_person`. Use the child's data for student fields.

#### The duplicated parent panel — read this twice
The parents table prints the SAME panel twice, side by side: two blocks both
headed הורה, each containing its own שם פרטי / מספר ת"ז / ארץ לידה / תאריך לידה /
מקום עבודה / עיסוק / טלפון בעבודה / טלפון נייד / כתובת אלקטרונית / מצב משפחתי.
Every one of those captions therefore appears TWICE on the same row.

- Put the FATHER in one whole panel and the MOTHER in the other whole panel.
  Assign the father to the RIGHT panel and the mother to the LEFT panel unless
  the form itself says otherwise.
- Add `"person": "father"` or `"person": "mother"` to every fill in this table,
  and append the marker to the label: `"שם פרטי (אב)"`, `"מספר ת\"ז (אם)"`.
  A downstream check uses this to verify the field really is in that parent's
  panel and moves it if the label_bbox picked the duplicate caption.
- The `label_bbox` you return MUST be the caption inside THAT parent's own
  panel. Two fills for the same person must never have label_bboxes on opposite
  sides of the table, and two fills for DIFFERENT people must never share one.
- Fill EVERY cell of BOTH panels for which a value exists. In particular
  `שם פרטי` and `מספר ת"ז` are required for BOTH parents — a panel that gets a
  birth date or a phone but no name and no ID number is a bug, not a choice.
  If a value genuinely does not exist in the data, put that exact cell in
  `missing_fields`; never leave it silently blank.
- Work panel by panel: emit the father's full set of fills, then the mother's
  full set, and count them before returning. If one person has more fills than
  the other, you skipped a cell — go back and add it.
- Hebrew names → use the `*_hebrew` fields. IDs, phones, emails, dates → use the
  raw LTR values. Dates in the family data are `DD-MM-YYYY`; output them as
  `DD/MM/YYYY`.
- Field-to-data hints:
  - "first name" → first_name_hebrew;  "family/last name" → family_name.hebrew
  - "ID number" / ת"ז → the 9-digit `id`
  - "date of birth" / תאריך לידה → birth_date (reformatted DD/MM/YYYY)
  - "city" / ישוב / עיר → address.city_hebrew
  - "postal code" / מיקוד / zip → address.zip   (NEVER put zip in the city field)
  - "street and number" / רחוב ומספר → address.street_hebrew
  - "neighborhood" / שכונה → ONLY if a neighborhood value exists; otherwise MISSING
  - "email" / כתובת אלקטרונית → the parent's email
  - "phone" → the matching parent phone
  - country of birth / ארץ לידה, שנת עלייה, מקום עבודה, עיסוק, טלפון בבית →
    only if present in the data; otherwise MISSING
- For a selection field (`is_selection: true`, e.g. `ז / נ`, `אב / אם`,
  `כן / לא`), decide which option is correct, then emit a fill with
  `field_type:"circle_option"` and copy that option's own `x/y/width/height`
  from its entry in the analysis `options` array (so the circle lands on the
  chosen word). If you cannot determine gender or another selection from the
  data, add it to `missing_fields` instead of guessing.
- ONE FILL = ONE FIELD. Never concatenate two field values into a single
  `value` string. `"4334801  רעננה עפרה חזה 1"` is WRONG: street, city and zip
  are three printed boxes and need three separate fills. The same applies to a
  parent's name + ID, or two parents' names -- each gets its own fill with its
  own `label_bbox`.
- For `id_digits`, emit ONE fill with the full 9-digit string as `value`; the
  engine splits it into the 9 boxes.
- For `signature`, emit a fill with `field_type:"signature"` and
  `value:"father"` or `value:"mother"` per the signer; the engine draws the PNG.
- Only emit `value` for a field when a real value exists. Do not add conditional
  fields (e.g. "if allergies, specify") to missing_fields when their condition
  is false — leave them out silently.

### Output Format — return ONLY this JSON
```json
{{
  "fills": [
    {{
      "field_id": "student_first_name_p1",
      "label": "שם פרטי",
      "page": 1,
      "field_type": "text",
      "fill_x": 780, "fill_y": 552, "fill_width": 120, "fill_height": 22,
      "fill_anchor": "right",
      "is_hebrew": true,
      "label_bbox": [900, 548, 962, 566],
      "fill_placement": "in_box",
      "value": "כליל"
    }},
    {{
      "field_id": "father_id_p1",
      "label": "מספר ת\"ז (אב)",
      "person": "father",
      "page": 1,
      "field_type": "text",
      "fill_x": 690, "fill_y": 366, "fill_width": 95, "fill_height": 20,
      "fill_anchor": "right",
      "is_hebrew": false,
      "label_bbox": [790, 362, 852, 378],
      "fill_placement": "in_box",
      "value": "034954990"
    }}
  ],
  "missing_fields": [
    {{"label": "שכונה", "page": 1, "hint": "neighborhood name"}}
  ]
}}
```"""


# ═══════════════════════════════════════════════════════════════════════════════
# CODE GENERATION PROMPT  (DEPRECATED — kept for reference, not used in v2 flow)
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
