#!/usr/bin/env python3
"""
Form Filler — Execute LLM-generated Python code to fill PDF forms.

Runs the code in a controlled namespace with ReportLab + PyPDF2 available.
Assets (fonts, signatures) are loaded from local paths or GCS.
"""

import io
import os
import sys
import logging
import tempfile
from pathlib import Path

log = logging.getLogger("formclaw.filler")

# Asset directories — local files bundled in the container
ASSETS_DIR = Path(os.environ.get("ASSETS_DIR", "/app/assets"))
FONTS_DIR = ASSETS_DIR / "fonts"
SIGNATURES_DIR = ASSETS_DIR / "signatures"


def execute_fill_code(code: str, pdf_bytes: bytes, family_data: dict) -> bytes:
    """
    Execute LLM-generated Python code that defines a fill_form() function.

    The code is expected to define:
        def fill_form(input_pdf_bytes: bytes, family_data: dict) -> bytes

    Returns the filled PDF as bytes.
    """
    log.info(f"Executing fill code ({len(code)} chars)")

    # Rewrite asset paths to point to container-local files
    code = rewrite_asset_paths(code)

    # Build execution namespace with allowed imports
    namespace = {
        "__builtins__": __builtins__,
        "io": io,
        "os": os,
        "sys": sys,
    }

    # Execute the code to define fill_form()
    try:
        exec(code, namespace)
    except Exception as e:
        raise RuntimeError(f"Code compilation failed: {e}") from e

    if "fill_form" not in namespace:
        raise RuntimeError("Generated code does not define fill_form() function")

    # Call fill_form with the PDF and family data
    try:
        result = namespace["fill_form"](pdf_bytes, family_data)
    except Exception as e:
        raise RuntimeError(f"fill_form() execution failed: {e}") from e

    if not isinstance(result, bytes):
        raise RuntimeError(f"fill_form() returned {type(result).__name__}, expected bytes")

    log.info(f"Fill code produced {len(result)} bytes of PDF")
    return result


def rewrite_asset_paths(code: str) -> str:
    """
    Rewrite hardcoded asset paths in generated code to use container paths.

    The LLM may generate paths like:
      '/home/ubuntu/shared/fonts/FtPilKahol2.ttf'
      '/home/ubuntu/shared/zr signature nxp.png'

    These need to map to:
      '/app/assets/fonts/FtPilKahol2.ttf'
      '/app/assets/signatures/zeev_signature.png'
    """
    replacements = {
        # Font paths
        "/home/ubuntu/shared/fonts/FtPilKahol2.ttf": str(FONTS_DIR / "FtPilKahol2.ttf"),
        "/home/ubuntu/shared/fonts/Playzone.ttf": str(FONTS_DIR / "Playzone.ttf"),
        "fonts/FtPilKahol2.ttf": str(FONTS_DIR / "FtPilKahol2.ttf"),
        "fonts/Playzone.ttf": str(FONTS_DIR / "Playzone.ttf"),

        # Signature paths (various possible forms)
        "/home/ubuntu/shared/zr signature nxp.png": str(SIGNATURES_DIR / "zeev_signature.png"),
        "/home/ubuntu/shared/keren sig.png": str(SIGNATURES_DIR / "keren_signature.png"),
        "signatures/zeev_signature.png": str(SIGNATURES_DIR / "zeev_signature.png"),
        "signatures/keren_signature.png": str(SIGNATURES_DIR / "keren_signature.png"),
        "zeev_signature.png": str(SIGNATURES_DIR / "zeev_signature.png"),
        "keren_signature.png": str(SIGNATURES_DIR / "keren_signature.png"),
    }

    for old, new in replacements.items():
        code = code.replace(old, new)

    return code
