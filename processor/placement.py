#!/usr/bin/env python3
"""
Placement resolver — decides, per field, WHERE the value physically goes.

Why this module exists
----------------------
The forms we fill are **scans**: they carry no text layer and no vector rules, so
the vision model can only *estimate* coordinates off a grid overlay. Auditing a
real filled output showed what that costs: values printed on top of the form's
own labels, values straddling cell borders, circles drawn on blank paper, the
postal code landing in the neighbourhood box, and only 4 of 108 values actually
seated on their ruled blank.

The fix is to stop trusting estimated coordinates as final. The LLM still says
WHAT value belongs to WHICH label, and roughly where that label is. This module
then *measures* the page (OpenCV on the rendered raster) and decides the
placement direction for every field:

    in_box | left_of_label | below_label | above_label | right_of_label

and returns a concrete draw rectangle that is guaranteed to be

  * inside the enclosing table cell (when there is one),
  * clear of every ruled line (no straddling),
  * clear of the form's own pre-printed ink (no overprinting the label),
  * clear of the other values already placed on that page.

Hebrew rule: for a Hebrew (RTL) form the value goes in the SAME box as the
label, to its LEFT, or BELOW it — never to its right. ``right_of_label`` is
therefore only reachable for explicitly LTR fields.

Coordinates
-----------
Everything this module returns is in **PDF points with the origin at the
bottom-left** (y increasing upward) — the same system ``form_filler_v2`` draws
in, so the values can be used verbatim.
"""

from __future__ import annotations

import io
import logging
import math
from dataclasses import dataclass, field as dc_field
from typing import Iterable, Sequence

log = logging.getLogger("formclaw.placement")

# ── Tunables ──────────────────────────────────────────────────────────────────
RENDER_DPI = 150.0            # raster resolution for line / ink detection
CELL_PAD = 3.0                # keep this far away from every cell border (pt)
INK_CLEAR = 3.5               # keep this far away from pre-printed ink (pt)
MAX_INK_OVERLAP = 0.02        # >2 % of the draw box on printed ink == collision
UNDERLINE_WINDOW = 26.0       # look this far below a label for its ruled blank
BASELINE_GAP = 1.5            # sit this far above the underline (pt)
MIN_BLANK_W = 11.0            # a usable blank must be at least this wide (pt)
MIN_BLANK_H = 8.0             # ...and this tall
LINE_MIN_LEN_PT = 12.0        # ignore ruled segments shorter than this
VLINE_MIN_LEN_PT = 14.0       # vertical borders must be at least this tall
VLINE_TOUCH_TOL = 5.0         # a real border ends within this of a horizontal rule
ROW_MERGE_TOL = 3.0           # horizontal rules this close are the same row edge
MAX_ROW_H = 96.0              # taller than this is not a single form row
VSPAN_FRACTION = 0.55         # a border must span this much of the row to split it
VALUE_GAP = 3.0               # minimum gap between two placed values (pt)
TOP_CLEARANCE = 1.5           # air between a value and the caption above it (pt)
                              # (must match form_filler_v2.TOP_CLEARANCE)

TARGET_FONT_SIZE = 14.0       # the size values should render at when the blank
                              # allows (must match form_filler_v2.TARGET_FONT_SIZE)
FLOOR_FONT_SIZE = 6.0         # never size below this (must match form_filler_v2)
# Mean advance per character, expressed against the NOMINAL font size (i.e. the
# face's optical multiplier is already folded in — see form_filler_v2._OPTICAL).
# Measured from the two house faces with reportlab's own metrics.
AVG_CHAR_W_LATIN = 0.40       # Playzone digits / e-mail / date text
AVG_CHAR_W_HEBREW = 0.52      # FtPilKahol2 Hebrew letters
# How many nominal points of type fit in one point of measured blank height.
# The handwriting Hebrew face draws taller for the same nominal size, so it gets
# the smaller ratio. Both mirror form_filler_v2.fit_font_size's height cap.
HEIGHT_TO_SIZE_HEBREW = 1.10
HEIGHT_TO_SIZE_LATIN = 1.35

PLACEMENTS = ("in_box", "left_of_label", "below_label", "above_label", "right_of_label")


def needed_width(value, font_size: float = TARGET_FONT_SIZE,
                 is_hebrew: bool = False) -> float:
    """Width the value needs at ``font_size``, so placement can prefer a blank
    that does not force the renderer to shrink the text."""
    n = len(str(value or ""))
    if not n:
        return 0.0
    k = AVG_CHAR_W_HEBREW if is_hebrew else AVG_CHAR_W_LATIN
    return n * font_size * k


def fitted_font_size(value, width: float, height: float, is_hebrew: bool = False,
                     target: float = TARGET_FONT_SIZE) -> float:
    """Largest font size at which ``value`` fits a ``width`` x ``height`` blank.

    A blank narrower than the value is NOT a defect to report — it is a size to
    solve for. This mirrors ``form_filler_v2.fit_font_size`` so the plan carries
    the size the renderer will actually use.
    """
    n = len(str(value or ""))
    size = float(target)
    if height and height > 1.0:
        ratio = HEIGHT_TO_SIZE_HEBREW if is_hebrew else HEIGHT_TO_SIZE_LATIN
        usable = max(1.0, height - BASELINE_GAP - TOP_CLEARANCE)
        size = min(size, max(FLOOR_FONT_SIZE, usable * ratio))
    if n and width and width > 0:
        k = AVG_CHAR_W_HEBREW if is_hebrew else AVG_CHAR_W_LATIN
        size = min(size, width / (n * k))
    return round(max(FLOOR_FONT_SIZE, size), 1)

# Placement preference order. Hebrew never falls through to right_of_label.
HEBREW_ORDER = ("in_box", "left_of_label", "below_label", "above_label")
LATIN_ORDER = ("in_box", "right_of_label", "below_label", "left_of_label", "above_label")


# ── Geometry container ────────────────────────────────────────────────────────

@dataclass
class PageGeometry:
    """Measured geometry of one page, in PDF points, bottom-left origin."""
    page_no: int
    width: float
    height: float
    hrules: list = dc_field(default_factory=list)   # (x0, x1, y)
    vrules: list = dc_field(default_factory=list)   # (x, y0, y1)
    cells: list = dc_field(default_factory=list)    # (x0, y0, x1, y1)
    bands: list = dc_field(default_factory=list)    # (y_bottom, y_top, x0, x1)
    _ink = None                                     # np.ndarray (H, W) bool, top-left
    _scale: float = RENDER_DPI / 72.0

    # -- ink queries ----------------------------------------------------------
    def _to_px(self, x0, y0, x1, y1):
        """rect in bottom-left pt -> (col0, row0, col1, row1) in the ink raster."""
        s = self._scale
        c0, c1 = int(round(x0 * s)), int(round(x1 * s))
        # flip y: bottom-left pt -> top-left px
        r0 = int(round((self.height - y1) * s))
        r1 = int(round((self.height - y0) * s))
        return c0, r0, c1, r1

    def ink_fraction(self, x0, y0, x1, y1) -> float:
        """Fraction of the rect covered by the form's own pre-printed ink."""
        if self._ink is None:
            return 0.0
        c0, r0, c1, r1 = self._to_px(x0, y0, x1, y1)
        h, w = self._ink.shape
        c0, r0 = max(c0, 0), max(r0, 0)
        c1, r1 = min(c1, w), min(r1, h)
        if c1 <= c0 or r1 <= r0:
            return 0.0
        return float(self._ink[r0:r1, c0:c1].mean())

    def is_blank(self, x0, y0, x1, y1) -> bool:
        return self.ink_fraction(x0, y0, x1, y1) <= MAX_INK_OVERLAP

    # -- rule queries ---------------------------------------------------------
    def cell_containing(self, x, y):
        """Smallest detected table cell containing the point, or None."""
        best = None
        for (cx0, cy0, cx1, cy1) in self.cells:
            if cx0 <= x <= cx1 and cy0 <= y <= cy1:
                area = (cx1 - cx0) * (cy1 - cy0)
                if best is None or area < best[0]:
                    best = (area, (cx0, cy0, cx1, cy1))
        return best[1] if best else None

    def band_containing(self, x, y):
        """Row band (between two ruled lines) containing the point, or None."""
        best = None
        for (yb, yt, bx0, bx1) in self.bands:
            if bx0 - 2 <= x <= bx1 + 2 and yb <= y <= yt:
                h = yt - yb
                if best is None or h < best[0]:
                    best = (h, (bx0, yb, bx1, yt))
        return best[1] if best else None

    def box_containing(self, x, y):
        """The tightest enclosure around the point: closed cell, else row band.

        Pages that are plain "label: ______" lines have no vertical borders at
        all, so there are no closed cells — the row band between two ruled lines
        is then the box the value must stay inside.
        """
        return self.cell_containing(x, y) or self.band_containing(x, y)

    def underline_below(self, x0, x1, y, window=UNDERLINE_WINDOW):
        """Nearest ruled segment below y that overlaps [x0,x1] by >=40 %.

        Returns (rx0, rx1, ry) or None. This is *the* fill location for a label
        that sits above an empty ruled blank.
        """
        w = max(x1 - x0, 1.0)
        best = None
        for (rx0, rx1, ry) in self.hrules:
            if ry > y + 1.0 or ry < y - window:
                continue
            ov = min(x1, rx1) - max(x0, rx0)
            if ov / w < 0.40:
                continue
            d = y - ry
            if best is None or d < best[0]:
                best = (d, (rx0, rx1, ry))
        return best[1] if best else None

    def underline_left_of(self, x, y, tol=4.0, reach=260.0):
        """Ruled segment on the SAME baseline reaching left from x.

        In Hebrew forms this is the classic "label: ______" blank — the empty
        underline to the LEFT of the label is where the value belongs.
        """
        best = None
        for (rx0, rx1, ry) in self.hrules:
            if abs(ry - y) > tol:
                continue
            if rx1 > x + 6.0 or rx1 < x - reach:
                continue
            if (rx1 - rx0) < LINE_MIN_LEN_PT:
                continue
            d = x - rx1
            if best is None or d < best[0]:
                best = (d, (rx0, rx1, ry))
        return best[1] if best else None

    def crosses_rule(self, x0, y0, x1, y1) -> bool:
        """True if the rect is cut by any ruled line (would straddle a border)."""
        for (x, ry0, ry1) in self.vrules:
            if x0 + 0.5 < x < x1 - 0.5 and ry0 - 2 <= (y0 + y1) / 2 <= ry1 + 2:
                return True
        for (rx0, rx1, y) in self.hrules:
            if y0 + 0.5 < y < y1 - 0.5 and rx0 - 2 <= (x0 + x1) / 2 <= rx1 + 2:
                return True
        return False


# ── Raster measurement ────────────────────────────────────────────────────────

def measure_page(pdf_bytes: bytes, page_no: int, dpi: float = RENDER_DPI) -> PageGeometry:
    """Render one page and extract its rules, cells and pre-printed ink mask.

    Degrades gracefully: if OpenCV / PyMuPDF are unavailable the returned
    geometry is simply empty, and every placement decision falls back to the
    coordinates the LLM supplied.
    """
    try:
        import numpy as np
        import cv2
        import fitz  # PyMuPDF
    except Exception as e:                                   # pragma: no cover
        log.warning(f"placement: CV stack unavailable ({e}); geometry disabled")
        return PageGeometry(page_no=page_no, width=595.0, height=842.0)

    scale = dpi / 72.0
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_no - 1]
        pw, ph = float(page.rect.width), float(page.rect.height)
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    finally:
        doc.close()

    geom = PageGeometry(page_no=page_no, width=pw, height=ph)
    geom._scale = scale

    # Binary: ink = True
    bw = cv2.adaptiveThreshold(img, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                               cv2.THRESH_BINARY_INV, 25, 12)

    min_len_px = max(int(LINE_MIN_LEN_PT * scale), 8)
    vmin_len_px = max(int(VLINE_MIN_LEN_PT * scale), 8)

    # -- horizontal rules --
    hk = cv2.getStructuringElement(cv2.MORPH_RECT, (min_len_px, 1))
    hmask = cv2.morphologyEx(bw, cv2.MORPH_OPEN, hk, iterations=1)
    # -- vertical rules --
    vk = cv2.getStructuringElement(cv2.MORPH_RECT, (1, vmin_len_px))
    vmask = cv2.morphologyEx(bw, cv2.MORPH_OPEN, vk, iterations=1)

    def _segments(mask, horizontal: bool):
        out = []
        n, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
        for i in range(1, n):
            x, y, w, h, _area = stats[i]
            if horizontal:
                if w < min_len_px or h > max(int(4 * scale), 4):
                    continue
                yc = (y + h / 2.0) / scale
                out.append((x / scale, (x + w) / scale, ph - yc))       # -> bottom-left
            else:
                if h < vmin_len_px or w > max(int(4 * scale), 4):
                    continue
                xc = (x + w / 2.0) / scale
                out.append((xc, ph - (y + h) / scale, ph - y / scale))  # -> bottom-left
        return out

    geom.hrules = _segments(hmask, True)
    # Hebrew letters with long descenders/ascenders (ן ך ו ל) survive the vertical
    # opening and masquerade as table borders. A genuine border touches a
    # horizontal rule at one end; a letter stroke does not.
    raw_v = _segments(vmask, False)
    hys = [y for (_a, _b, y) in geom.hrules]
    geom.vrules = [
        (x, y0, y1) for (x, y0, y1) in raw_v
        if any(abs(y0 - hy) <= VLINE_TOUCH_TOL or abs(y1 - hy) <= VLINE_TOUCH_TOL
               for hy in hys)
    ] or raw_v

    # -- pre-printed ink WITHOUT the rules (so "on the label" != "on the line") --
    ink = cv2.bitwise_and(bw, cv2.bitwise_not(cv2.bitwise_or(hmask, vmask)))
    ink = cv2.morphologyEx(ink, cv2.MORPH_OPEN,
                           cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)))
    geom._ink = (ink > 0)

    geom.bands = _row_bands(geom)
    geom.cells = _build_cells(geom)
    log.info(f"placement: page {page_no} measured — {len(geom.hrules)} h-rules, "
             f"{len(geom.vrules)} v-rules, {len(geom.bands)} row bands, "
             f"{len(geom.cells)} cells")
    return geom


def _row_bands(geom: PageGeometry) -> list:
    """Horizontal bands between consecutive ruled lines -> (y_bottom, y_top, x0, x1).

    Rules that are within ROW_MERGE_TOL of each other are one edge (scans give
    doubled lines). The band's x-extent is the union of the two edges, which is
    what the value has to stay inside.
    """
    if not geom.hrules:
        return []
    # cluster rules by y
    clusters = []
    for (x0, x1, y) in sorted(geom.hrules, key=lambda r: -r[2]):
        if clusters and abs(clusters[-1]["y"] - y) <= ROW_MERGE_TOL:
            c = clusters[-1]
            c["x0"] = min(c["x0"], x0)
            c["x1"] = max(c["x1"], x1)
            c["y"] = (c["y"] * c["n"] + y) / (c["n"] + 1)
            c["n"] += 1
        else:
            clusters.append({"y": y, "x0": x0, "x1": x1, "n": 1})

    bands = []
    for a, b in zip(clusters, clusters[1:]):
        h = a["y"] - b["y"]
        if h < MIN_BLANK_H or h > MAX_ROW_H:
            continue
        lo, hi = max(a["x0"], b["x0"]), min(a["x1"], b["x1"])
        if (hi - lo) < MIN_BLANK_W:
            # edges barely overlap: fall back to their union so a wide label row
            # bounded by two short rules is still usable
            lo, hi = min(a["x0"], b["x0"]), max(a["x1"], b["x1"])
        if (hi - lo) < MIN_BLANK_W:
            continue
        bands.append((b["y"], a["y"], lo, hi))
    return bands


def _build_cells(geom: PageGeometry) -> list:
    """Reconstruct closed table cells: every row band split by its real borders."""
    cells = []
    for (yb, yt, lo, hi) in geom.bands:
        h = yt - yb
        xs = {round(lo, 1), round(hi, 1)}
        for (x, vy0, vy1) in geom.vrules:
            if x < lo - 3 or x > hi + 3:
                continue
            # the border must span most of the band to actually divide it
            cover = min(vy1, yt) - max(vy0, yb)
            if cover / h >= VSPAN_FRACTION:
                xs.add(round(min(max(x, lo), hi), 1))
        xs = sorted(xs)
        # merge x positions that are too close to bound a usable cell
        merged = [xs[0]]
        for x in xs[1:]:
            if x - merged[-1] < MIN_BLANK_W:
                continue
            merged.append(x)
        if merged[-1] < hi - 1.0:
            merged[-1] = hi
        for a, b in zip(merged, merged[1:]):
            if (b - a) >= MIN_BLANK_W:
                cells.append((a, yb, b, yt))
    # de-duplicate
    seen, out = set(), []
    for c in cells:
        k = tuple(round(v) for v in c)
        if k not in seen:
            seen.add(k)
            out.append(c)
    return out


# ── Placement resolution ──────────────────────────────────────────────────────

@dataclass
class Placement:
    placement: str
    x: float
    y: float
    width: float
    height: float
    anchor: str
    confidence: float
    reason: str

    def as_dict(self) -> dict:
        return {
            "fill_placement": self.placement,
            "fill_x": round(self.x, 1),
            "fill_y": round(self.y, 1),
            "fill_width": round(self.width, 1),
            "fill_height": round(self.height, 1),
            "fill_anchor": self.anchor,
            "placement_confidence": round(self.confidence, 2),
            "placement_reason": self.reason,
        }


def _clamp_to_cell(x0, y0, x1, y1, cell):
    cx0, cy0, cx1, cy1 = cell
    x0 = max(x0, cx0 + CELL_PAD)
    x1 = min(x1, cx1 - CELL_PAD)
    y0 = max(y0, cy0 + CELL_PAD)
    y1 = min(y1, cy1 - CELL_PAD)
    return x0, y0, x1, y1


def _score(geom: PageGeometry, rect, taken: Sequence[tuple],
           need_w: float = 0.0) -> float:
    """0..1 quality of a candidate rect. 0 == unusable.

    ``need_w`` is the width the value needs at the target font size. A blank that
    fits the value without shrinking is strongly preferred, because the audit
    showed illegibly small text was the single most common defect.
    """
    x0, y0, x1, y1 = rect
    w, h = x1 - x0, y1 - y0
    if w < MIN_BLANK_W or h < MIN_BLANK_H:
        return 0.0
    if geom.crosses_rule(x0, y0, x1, y1):
        return 0.0
    ink = geom.ink_fraction(x0, y0, x1, y1)
    if ink > MAX_INK_OVERLAP:
        return 0.0
    for (tx0, ty0, tx1, ty1) in taken:
        if (min(x1, tx1) - max(x0, tx0)) > -VALUE_GAP and \
           (min(y1, ty1) - max(y0, ty0)) > -VALUE_GAP:
            return 0.0
    # prefer wide, blank, generously tall blanks
    base = min(1.0, 0.55 + 0.35 * min(w / 140.0, 1.0) + 0.10 * min(h / 20.0, 1.0)) \
        * (1.0 - ink / MAX_INK_OVERLAP * 0.25)
    if need_w > 0:
        # scale by how much of the needed width is available: a blank that would
        # force the text down to half size scores half as well.
        base *= 0.45 + 0.55 * min(w / need_w, 1.0)
    # A blank shorter than the glyphs themselves forces the renderer to shrink
    # the value vertically too, so a short-but-wide gap must lose to a taller one.
    base *= 0.55 + 0.45 * min(h / (TARGET_FONT_SIZE * 1.15), 1.0)
    return base


def _trim_anchor(geom: "PageGeometry", rect, anchor: str = "right",
                 max_trim: float = 28.0, strip: float = 9.0):
    """Pull the rect's anchor edge back until it no longer sits on printed ink.

    A ``label_bbox`` supplied by the vision model (or by OCR) is only
    approximate. For an RTL field the value is drawn flush against the rect's
    RIGHT edge, so a caption edge that is a few points off is enough to print
    the value straight over the caption -- which is exactly error class
    E2-OVERPRINT in the audit. Checking the whole rect's ink fraction does not
    catch it: a wide rect can be under the 2%% ink budget while the few points
    where the text actually starts are solid black. So we test only the strip at
    the anchor edge and walk it inward.
    """
    x0, y0, x1, y1 = rect
    if geom._ink is None:
        return rect
    step, moved = 1.5, 0.0
    while moved < max_trim and (x1 - x0) > MIN_BLANK_W:
        s = (x1 - strip, y0, x1, y1) if anchor == "right" else (x0, y0, x0 + strip, y1)
        if geom.ink_fraction(*s) < 0.025:
            break
        if anchor == "right":
            x1 -= step
        else:
            x0 += step
        moved += step
    return (x0, y0, x1, y1)


def _candidate(kind, geom, label, taken, need_w: float = 0.0):
    """Build the candidate draw rect for one placement direction, or None."""
    lx0, ly0, lx1, ly1 = label
    lh = max(ly1 - ly0, 10.0)

    if kind == "in_box":
        cell = geom.box_containing((lx0 + lx1) / 2.0, (ly0 + ly1) / 2.0)
        if not cell:
            return None
        cx0, cy0, cx1, cy1 = cell
        # free space to the LEFT of the label text inside the same cell
        left = (cx0 + CELL_PAD, cy0 + CELL_PAD, lx0 - INK_CLEAR, cy1 - CELL_PAD)
        # free space BELOW the label text inside the same cell
        below = (cx0 + CELL_PAD, cy0 + CELL_PAD, cx1 - CELL_PAD, ly0 - INK_CLEAR)
        # ...and to the RIGHT, for a caption that is flush with the cell's right
        # edge (only usable when there is genuinely room and no ink there)
        right = (lx1 + INK_CLEAR, cy0 + CELL_PAD, cx1 - CELL_PAD, cy1 - CELL_PAD)
        best, bs = None, 0.0
        for r, why, anch in ((left, "free space left of the label, same box", "right"),
                             (below, "free space below the label, same box", "right"),
                             (right, "free space right of the label, same box", "left")):
            r = _trim_anchor(geom, r, anch)
            s = _score(geom, r, taken, need_w)
            if s > bs:
                best, bs = (r, why), s
        if not best:
            return None
        (rx0, ry0, rx1, ry1), why = best
        return Placement("in_box", rx1, ry0 + BASELINE_GAP, rx1 - rx0,
                         ry1 - ry0, "right", bs, why)

    if kind == "left_of_label":
        rule = geom.underline_left_of(lx0, ly0)
        if rule:
            rx0, rx1, ry = rule
            r = _trim_anchor(geom, (rx0 + 1.0, ry + BASELINE_GAP,
                                    min(rx1, lx0 - INK_CLEAR),
                                    ry + BASELINE_GAP + lh * 1.4), "right")
            s = _score(geom, r, taken, need_w)
            if s > 0:
                return Placement("left_of_label", r[2], r[1], r[2] - r[0], r[3] - r[1],
                                 "right", s, f"empty underline left of the label at y={ry:.0f}")
        # no ruled blank: use whatever blank space is immediately left
        r = _trim_anchor(geom, (max(lx0 - 170.0, 6.0), ly0,
                                lx0 - INK_CLEAR, ly0 + lh * 1.3), "right")
        s = _score(geom, r, taken, need_w)
        if s > 0:
            return Placement("left_of_label", r[2], r[1], r[2] - r[0], r[3] - r[1],
                             "right", s * 0.75, "blank area left of the label (no rule found)")
        return None

    if kind == "below_label":
        rule = geom.underline_below(lx0, lx1, ly0)
        if rule:
            rx0, rx1, ry = rule
            # never let the value climb back up into the label's own line
            top = min(ry + BASELINE_GAP + lh * 1.4, ly0 - INK_CLEAR)
            r = _trim_anchor(geom, (max(rx0 + 1.0, lx0 - 40.0), ry + BASELINE_GAP,
                                    min(rx1 - 1.0, lx1 + 40.0), top), "right")
            s = _score(geom, r, taken, need_w)
            if s > 0:
                return Placement("below_label", r[2], r[1], r[2] - r[0], r[3] - r[1],
                                 "right", s, f"ruled blank directly under the label at y={ry:.0f}")
        r = _trim_anchor(geom, (lx0, ly0 - lh * 1.5, lx1, ly0 - INK_CLEAR), "right")
        s = _score(geom, r, taken, need_w)
        if s > 0:
            return Placement("below_label", r[2], r[1], r[2] - r[0], r[3] - r[1],
                             "right", s * 0.7, "blank area under the label (no rule found)")
        return None

    if kind == "above_label":
        r = (lx0, ly1 + INK_CLEAR, lx1, ly1 + lh * 1.5)
        s = _score(geom, r, taken, need_w)
        if s > 0:
            return Placement("above_label", r[2], r[1], r[2] - r[0], r[3] - r[1],
                             "right", s * 0.5, "blank area above the label")
        return None

    if kind == "right_of_label":
        r = (lx1 + INK_CLEAR, ly0, lx1 + 170.0, ly0 + lh * 1.3)
        s = _score(geom, r, taken, need_w)
        if s > 0:
            return Placement("right_of_label", r[0], r[1], r[2] - r[0], r[3] - r[1],
                             "left", s * 0.9, "blank area right of the label (LTR field)")
        return None

    return None


def resolve_placement(geom: PageGeometry, label_bbox, *, rtl_label: bool = True,
                      hint: str | None = None, taken: Sequence[tuple] = (),
                      need_w: float = 0.0) -> Placement | None:
    """Decide where the value for ``label_bbox`` must be drawn.

    Args:
        geom:        measured page geometry.
        label_bbox:  (x0, y0, x1, y1) of the printed LABEL, bottom-left origin.
        rtl_label:   True when the printed LABEL is Hebrew/RTL. This is about the
                     *label*, not the value: a Hebrew caption reads right-to-left,
                     so its blank is to the LEFT even when the value itself is a
                     Latin date or phone number. ``right_of_label`` is then
                     forbidden, because the space right of a Hebrew caption
                     belongs to the previous field.
        hint:        the LLM's suggested placement; tried first when plausible.
        taken:       rects already occupied by previously placed values.

    Returns the winning Placement, or None when the page could not be measured
    and the caller should fall back to the LLM coordinates.
    """
    if not geom.hrules and not geom.vrules and geom._ink is None:
        return None

    order = list(HEBREW_ORDER if rtl_label else LATIN_ORDER)
    if hint:
        hint = str(hint).strip().lower()
        if hint == "right_of_label" and rtl_label:
            log.info("placement: rejecting right_of_label on a Hebrew field "
                     "(value would collide with the label)")
        elif hint in order:
            order.remove(hint)
            order.insert(0, hint)

    best, best_score = None, 0.0
    for kind in order:
        cand = _candidate(kind, geom, label_bbox, taken, need_w)
        if cand is None:
            continue
        # first plausible candidate in preference order wins unless a later one
        # is clearly better
        weight = cand.confidence + (0.15 if kind == order[0] else 0.0)
        if weight > best_score:
            best, best_score = cand, weight
    return best


# ── Mark snapping (circles / X's) ──────────────────────────────────────────────

def snap_mark_to_ink(geom: PageGeometry, target_bbox, max_shift: float = 22.0):
    """Move a circle/X so it actually lands on the option it is meant to mark.

    Audit finding this fixes: 16 of 18 marks in the reviewed output were drawn on
    blank paper, typically 9-18 pt away from the word they were supposed to
    circle. Here we search a small neighbourhood for the densest ink cluster and
    return a rect centred on it.
    """
    if geom._ink is None:
        return None
    x0, y0, x1, y1 = target_bbox
    if geom.ink_fraction(x0, y0, x1, y1) > 0.04:
        return tuple(target_bbox)          # already on the option

    w, h = x1 - x0, y1 - y0
    best, best_ink = None, 0.0
    step = 2.0
    n = int(max_shift / step)
    for dy in range(-n, n + 1):
        for dx in range(-n, n + 1):
            r = (x0 + dx * step, y0 + dy * step, x1 + dx * step, y1 + dy * step)
            f = geom.ink_fraction(*r)
            # prefer the closest good hit, so penalise distance
            f -= 0.0006 * math.hypot(dx * step, dy * step)
            if f > best_ink:
                best, best_ink = r, f
    if best and best_ink > 0.04:
        log.info(f"placement: snapped mark by "
                 f"({best[0]-x0:+.0f},{best[1]-y0:+.0f})pt onto ink ({best_ink*100:.0f}%)")
        return best
    log.warning(f"placement: no ink found within {max_shift}pt of mark target "
                f"{[round(v) for v in target_bbox]} — mark suppressed")
    return None


# ── Plan post-processing ──────────────────────────────────────────────────────

_MARK_TYPES = {"checkbox", "circle_option", "radio"}

_HEBREW_RANGE = ("\u0590", "\u05FF")


def _has_hebrew(text) -> bool:
    return any(_HEBREW_RANGE[0] <= ch <= _HEBREW_RANGE[1] for ch in str(text or ""))


def _is_rtl_label(fill: dict, default: bool) -> bool:
    """Is the printed caption for this fill right-to-left?

    Decided from the LABEL text, which is what governs which side of the caption
    the blank sits on. Falls back to the form-level direction when the plan did
    not carry a label string.
    """
    for key in ("label", "field_id", "label_hebrew"):
        if _has_hebrew(fill.get(key)):
            return True
    if fill.get("label"):
        # a real label that contains no Hebrew at all -> treat as LTR
        return False
    return default


# ── Duplicated person blocks (the parents table) ──────────────────────────────
#
# A Hebrew school form prints the parent block TWICE side by side: two identical
# "הורה" panels, each with its own שם פרטי / מספר ת"ז / תאריך לידה ... captions.
# Every caption therefore appears twice on the same row, and a vision model that
# matches a field to "the caption that reads שם פרטי" can easily lock onto the
# WRONG copy. The observed failure was exactly that: the mother's first name was
# written into the father's panel, on top of his row.
#
# The fix is structural, not statistical: all of one person's fields must live in
# ONE panel. Any field whose label sits in the other panel is moved to the
# matching cell of its own panel — matched by position within the panel, counting
# from the panel's right edge, because the panels are translated copies.

# The form's parent panels are identical and unlabelled; the RTL convention (and
# the fill-plan prompt) puts the father in the first, right-hand panel.
PREFERRED_RIGHT_PERSON = "father"

_PERSON_MARKERS = (
    ("father", ("(אב)", "אב", "האב", "father", "dad", "הורה 1", "הורה א")),
    ("mother", ("(אם)", "אם", "האם", "mother", "mom", "הורה 2", "הורה ב")),
)


def person_of(fill: dict) -> str | None:
    """Which family member this fill belongs to: 'father', 'mother' or None.

    Prefers the plan's explicit ``person`` key; falls back to the (אב)/(אם)
    marker the prompt asks the model to append to duplicated captions.
    """
    explicit = str(fill.get("person") or "").strip().lower()
    if explicit in ("father", "mother"):
        return explicit
    text = " ".join(str(fill.get(k) or "") for k in ("label", "field_id"))
    for who, markers in _PERSON_MARKERS:
        for m in markers:
            if m in text:
                return who
    return None


def _band_cells(geom: PageGeometry, y: float) -> list:
    """All cells whose row band contains ``y``, ordered LEFT to RIGHT."""
    same = [c for c in geom.cells if c[1] - 1.0 <= y <= c[3] + 1.0]
    return sorted(same, key=lambda c: c[0])


def panel_divider(geom: PageGeometry, ys: Sequence[float]) -> float | None:
    """x of the border that splits a duplicated-panel table into two halves.

    Derived from the measured cell grid, not from where the model thinks the
    labels are: a row of a duplicated panel has an even number of cells, and the
    panels meet at the middle border. Taking the median over every row the plan
    touches makes this robust to one misdetected row.
    """
    cands = []
    for y in ys:
        row = _band_cells(geom, y)
        n = len(row)
        if n >= 2 and n % 2 == 0:
            cands.append(row[n // 2][0])
    if not cands:
        return None
    cands.sort()
    return cands[len(cands) // 2]


def _same_cell(a, b) -> bool:
    return abs(a[0] - b[0]) < 0.6 and abs(a[2] - b[2]) < 0.6 and \
        abs(a[1] - b[1]) < 0.6 and abs(a[3] - b[3]) < 0.6


def _twin_cell(geom: PageGeometry, cell, divider: float, want_right: bool):
    """The cell holding the same caption in the OTHER copy of the panel.

    Panels are translated copies of one layout, so the n-th cell counted from a
    panel's RIGHT edge is the same field in both panels — which holds even when
    the two panels are not the same overall width (the outer column of the left
    panel on this form is wider than its counterpart).
    """
    row = _band_cells(geom, (cell[1] + cell[3]) / 2.0)
    right = sorted([c for c in row if (c[0] + c[2]) / 2.0 >= divider],
                   key=lambda c: c[2], reverse=True)
    left = sorted([c for c in row if (c[0] + c[2]) / 2.0 < divider],
                  key=lambda c: c[2], reverse=True)
    if not right or len(right) != len(left):
        return None                      # not a cleanly duplicated row
    src, dst = (left, right) if want_right else (right, left)
    idx = next((i for i, c in enumerate(src) if _same_cell(c, cell)), -1)
    if idx < 0 or idx >= len(dst):
        return None
    return dst[idx]


def enforce_person_blocks(page_fills: Sequence[dict], geom: PageGeometry) -> int:
    """Pull every field of one person into that person's own panel.

    Returns the number of label bboxes corrected. Fills are mutated in place.
    """
    tagged: dict[str, list] = {}
    for f in page_fills:
        lb = f.get("label_bbox")
        if not (isinstance(lb, (list, tuple)) and len(lb) == 4):
            continue
        who = person_of(f)
        if who:
            tagged.setdefault(who, []).append(f)

    if len(tagged) < 2 or any(len(v) < 2 for v in tagged.values()):
        return 0                          # nothing to cross-check

    def cx(f):
        lb = f["label_bbox"]
        return (float(lb[0]) + float(lb[2])) / 2.0

    def cy(f):
        lb = f["label_bbox"]
        return (float(lb[1]) + float(lb[3])) / 2.0

    all_fills = [f for fl in tagged.values() for f in fl]
    divider = panel_divider(geom, [cy(f) for f in all_fills])
    if divider is None:
        return 0

    # Which person owns which panel: majority vote, tie broken by median x.
    score = {}
    for who, fl in tagged.items():
        right = sum(1 for f in fl if cx(f) >= divider)
        xs = sorted(cx(f) for f in fl)
        score[who] = (right - (len(fl) - right), xs[len(xs) // 2])
    ordered = sorted(tagged, key=lambda w: score[w], reverse=True)
    who_right, who_left = ordered[0], ordered[-1]
    if who_right == who_left:
        return 0
    # The form is RTL, so the first parent panel is the right-hand one and the
    # convention (and the fill-plan prompt) puts the father there. Only apply
    # that as a tie-break: if the plan itself clearly put one parent on a given
    # side, respect the plan.
    if len(ordered) == 2 and score[ordered[0]][0] == score[ordered[1]][0] \
            and PREFERRED_RIGHT_PERSON in tagged:
        who_right = PREFERRED_RIGHT_PERSON
        who_left = next(w for w in tagged if w != who_right)

    fixed = 0
    for who, want_right in ((who_right, True), (who_left, False)):
        for f in tagged[who]:
            if (cx(f) >= divider) == want_right:
                continue                  # already in this person's panel
            lb = [float(v) for v in f["label_bbox"]]
            cell = geom.box_containing((lb[0] + lb[2]) / 2.0, (lb[1] + lb[3]) / 2.0)
            if not cell:
                log.warning(f"placement: '{f.get('label')}' is in the wrong parent "
                            f"panel but its label is not inside any cell — left as-is")
                continue
            twin = _twin_cell(geom, cell, divider, want_right)
            if not twin:
                log.warning(f"placement: '{f.get('label')}' is in the wrong parent "
                            f"panel but no matching cell was found — left as-is")
                continue
            # Captions are flush with the cell's right edge in an RTL panel, so
            # align the label's right edge with the twin cell's right edge.
            dx = twin[2] - cell[2]
            f["label_bbox"] = [round(lb[0] + dx, 1), round(lb[1], 1),
                               round(lb[2] + dx, 1), round(lb[3], 1)]
            f["placement_correction"] = (
                f"moved into the {who}'s own panel (the label had been matched to "
                f"the duplicate caption {abs(dx):.0f}pt away)")
            log.warning(f"placement: '{f.get('label')}' was matched to the wrong "
                        f"parent panel; shifted {dx:+.0f}pt into the {who}'s panel")
            fixed += 1
    return fixed


# Captions that must be present for a person once that person appears in the
# plan at all. Keyed by a short name used in the gap report.
_REQUIRED_PERSON_FIELDS = {
    "name": ("שם פרטי", "first name", "שם"),
    "id": ('ת"ז', "תז", "ת.ז", "id number", "מספר זהות", "תעודת זהות"),
}


def audit_plan_gaps(fill_plan: dict) -> list:
    """Report parents whose panel got some fields but not the essential ones.

    The observed failure was a plan that filled one parent's birth date, phone
    and email but neither parent's name or ID number. That is never a legitimate
    outcome, so it is surfaced as a gap the caller can retry on.
    """
    fills = [f for f in (fill_plan.get("fills") or []) if isinstance(f, dict)]
    declared_missing = " ".join(
        str(m.get("label") if isinstance(m, dict) else m)
        for m in (fill_plan.get("missing_fields") or [])
    )
    by_person: dict[str, list] = {}
    for f in fills:
        who = person_of(f)
        if who:
            by_person.setdefault(who, []).append(f)

    gaps = []
    for who, group in by_person.items():
        labels = " ".join(str(f.get("label") or "") + " " + str(f.get("field_id") or "")
                          for f in group).lower()
        for key, markers in _REQUIRED_PERSON_FIELDS.items():
            if any(m.lower() in labels for m in markers):
                continue
            # already acknowledged as unavailable? then it is not a gap
            if any(m in declared_missing for m in markers):
                continue
            gaps.append({"person": who, "missing": key,
                         "detail": f"{who} has {len(group)} field(s) in the plan "
                                   f"but no {key} field"})
    return gaps


def apply_placement(fill_plan: dict, pdf_bytes: bytes) -> dict:
    """Re-place every fill in the plan using measured page geometry.

    This is the step that turns *estimated* coordinates into *measured* ones. It
    rewrites ``fill_x / fill_y / fill_width / fill_height / fill_anchor`` and adds
    ``fill_placement`` + ``placement_reason`` for traceability. Fills whose
    target cannot be found on the page are dropped into ``suppressed`` rather
    than being drawn somewhere wrong.
    """
    if not isinstance(fill_plan, dict):
        return fill_plan

    fills = [f for f in (fill_plan.get("fills") or []) if isinstance(f, dict)]
    if not fills:
        return fill_plan

    by_page: dict[int, list] = {}
    for f in fills:
        try:
            p = int(f.get("page", 1) or 1)
        except (TypeError, ValueError):
            p = 1
        by_page.setdefault(p, []).append(f)

    suppressed = []
    stats = {"measured": 0, "relocated": 0, "kept": 0, "suppressed": 0,
             "marks_snapped": 0, "shrunk_to_fit": 0, "panel_corrections": 0}
    # Hebrew forms unless the plan says otherwise.
    rtl_default = str(fill_plan.get("form_direction", "rtl")).lower() != "ltr"

    for page_no, page_fills in sorted(by_page.items()):
        try:
            geom = measure_page(pdf_bytes, page_no)
        except Exception as e:
            log.error(f"placement: could not measure page {page_no}: {e}")
            continue
        stats["measured"] += 1

        # A duplicated parent panel makes every caption appear twice on a row;
        # make sure each person's fields all sit in that person's own panel
        # BEFORE any of them claim space.
        try:
            stats["panel_corrections"] += enforce_person_blocks(page_fills, geom)
        except Exception as e:
            log.error(f"placement: parent-panel check failed on page {page_no}: {e}")

        taken: list[tuple] = []
        # Place the most constrained fields first: narrow blanks before wide ones.
        for f in sorted(page_fills, key=lambda d: float(d.get("fill_width", 999) or 999)):
            ftype = str(f.get("field_type", "text")).lower()

            # --- marks: snap onto the option glyphs -------------------------
            if ftype in _MARK_TYPES:
                tb = (float(f.get("fill_x", 0) or 0),
                      float(f.get("fill_y", 0) or 0),
                      float(f.get("fill_x", 0) or 0) + float(f.get("fill_width", 24) or 24),
                      float(f.get("fill_y", 0) or 0) + float(f.get("fill_height", 12) or 12))
                snapped = snap_mark_to_ink(geom, tb)
                if snapped is None:
                    f["_suppressed"] = "no option ink found near the requested position"
                    suppressed.append(f)
                    stats["suppressed"] += 1
                    continue
                if tuple(round(v, 1) for v in snapped) != tuple(round(v, 1) for v in tb):
                    stats["marks_snapped"] += 1
                f["fill_x"], f["fill_y"] = round(snapped[0], 1), round(snapped[1], 1)
                f["fill_width"] = round(snapped[2] - snapped[0], 1)
                f["fill_height"] = round(snapped[3] - snapped[1], 1)
                f["fill_placement"] = "on_option"
                taken.append(snapped)
                continue

            # --- text-like fields ------------------------------------------
            lb = f.get("label_bbox")
            if not (isinstance(lb, (list, tuple)) and len(lb) == 4):
                # No label geometry to reason about — keep the LLM coordinates
                # but still refuse to overprint ink or straddle a rule.
                x = float(f.get("fill_x", 0) or 0)
                y = float(f.get("fill_y", 0) or 0)
                w = float(f.get("fill_width", 0) or 0)
                h = float(f.get("fill_height", 12) or 12)
                rect = (x - w, y, x, y + h) if str(
                    f.get("fill_anchor", "right")).lower() == "right" else (x, y, x + w, y + h)
                if _score(geom, rect, taken) > 0:
                    f.setdefault("fill_placement", "as_planned")
                    f["placement_reason"] = "no label bbox; LLM coordinates verified clean"
                    f["font_size"] = fitted_font_size(f.get("value"), w, h,
                                                      bool(f.get("is_hebrew")))
                    taken.append(rect)
                    stats["kept"] += 1
                else:
                    f["_suppressed"] = ("LLM coordinates land on printed ink or across a "
                                        "rule and no label bbox was supplied to relocate them")
                    suppressed.append(f)
                    stats["suppressed"] += 1
                continue

            label = tuple(float(v) for v in lb)
            # Direction comes from the LABEL's script, never from the value's.
            # `is_hebrew` in the plan means "render the VALUE with the Hebrew
            # font" — a תאריך לידה caption is RTL even though its value is
            # "20/03/2014", so its blank is still to the LEFT.
            need_w = needed_width(f.get("value"), TARGET_FONT_SIZE,
                                  bool(f.get("is_hebrew")))
            pl = resolve_placement(geom, label, rtl_label=_is_rtl_label(f, rtl_default),
                                   hint=f.get("fill_placement"), taken=taken,
                                   need_w=need_w)
            if pl is None:
                f["_suppressed"] = "no blank space found in, left of, below or above the label"
                suppressed.append(f)
                stats["suppressed"] += 1
                continue

            f.update(pl.as_dict())
            # A blank narrower than the value is not an error to report back —
            # it is a size to solve for. Work out the largest size that fits the
            # measured blank and hand it to the renderer.
            size = fitted_font_size(f.get("value"), pl.width, pl.height,
                                    bool(f.get("is_hebrew")))
            f["font_size"] = size
            f["needed_width"] = round(need_w, 1)
            f["fits_at_target_font"] = bool(size >= TARGET_FONT_SIZE - 0.05)
            if not f["fits_at_target_font"]:
                stats["shrunk_to_fit"] += 1
                log.info(
                    f"placement: '{f.get('label')}' (page {page_no}) has "
                    f"{pl.width:.0f}pt for a value needing {need_w:.0f}pt at "
                    f"{TARGET_FONT_SIZE:.0f}pt — rendering it at {size:.1f}pt"
                )
            stats["relocated"] += 1
            if pl.anchor == "right":
                taken.append((pl.x - pl.width, pl.y, pl.x, pl.y + pl.height))
            else:
                taken.append((pl.x, pl.y, pl.x + pl.width, pl.y + pl.height))

    if suppressed:
        keep = [f for f in fills if "_suppressed" not in f]
        fill_plan["fills"] = keep
        fill_plan.setdefault("suppressed_fills", []).extend(
            {"label": f.get("label"), "page": f.get("page"), "reason": f["_suppressed"]}
            for f in suppressed
        )
        # Anything we could not place becomes a question for the parent instead
        # of a wrongly-drawn value.
        missing = fill_plan.setdefault("missing_fields", [])
        for f in suppressed:
            if f.get("label"):
                missing.append({"label": f["label"], "page": f.get("page"),
                                "hint": f"could not be placed automatically: {f['_suppressed']}"})

    gaps = audit_plan_gaps(fill_plan)
    if gaps:
        fill_plan["plan_gaps"] = gaps
        for g in gaps:
            log.warning(f"plan gap: {g['detail']}")
    stats["plan_gaps"] = len(gaps)
    fill_plan["placement_stats"] = stats
    log.info(f"placement: {stats}")
    return fill_plan
