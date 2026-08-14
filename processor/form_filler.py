#!/usr/bin/env python3
"""
Form Filler — Execute LLM-generated Python code to fill PDF forms.

Runs the code in a controlled namespace with ReportLab + PyPDF2 available.
Assets (fonts, signatures) are loaded from local paths or GCS.
"""

import io
import os
import logging
from pathlib import Path

log = logging.getLogger("formclaw.filler")

# Asset directories — local files bundled in the container
ASSETS_DIR = Path(os.environ.get("ASSETS_DIR", "/app/assets"))
FONTS_DIR = ASSETS_DIR / "fonts"
SIGNATURES_DIR = ASSETS_DIR / "signatures"

# Modules the LLM-generated fill code is allowed to import.
# Kept to what's needed for PDF form filling (ReportLab + PyPDF2 + imaging)
# plus common stdlib helpers. Any submodule of these is also permitted
# (e.g. "reportlab.pdfgen.canvas", "PIL.Image").
_ALLOWED_IMPORTS = frozenset({
    # Core PDF / imaging stack
    "reportlab", "PyPDF2", "pypdf", "PIL", "pillow_heif", "fitz",
    # I/O and math
    "io", "os", "math", "decimal", "fractions", "random", "statistics",
    # Text / data helpers
    "re", "json", "csv", "string", "textwrap", "base64", "binascii",
    "unicodedata", "html",
    # Date / time
    "datetime", "time", "calendar",
    # Collections / functional
    "collections", "itertools", "functools", "operator", "copy",
    "typing", "dataclasses", "enum", "types", "abc", "numbers",
    "bisect", "heapq", "array",
})


def _make_safe_import():
    """
    Build a restricted ``__import__`` for the sandbox.

    Standard ``import`` statements in the generated code call this. It allows
    modules whose top-level package is in ``_ALLOWED_IMPORTS`` (and any of
    their submodules) and blocks everything else.
    """
    _real_import = __import__

    def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
        root = name.split(".", 1)[0] if name else name
        if root not in _ALLOWED_IMPORTS:
            raise ImportError(f"import of '{name}' is not allowed in the sandbox")
        return _real_import(name, globals, locals, fromlist, level)

    return _safe_import


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

    # Build execution namespace with restricted builtins (sandbox)
    _SAFE_BUILTINS = {
        # Import machinery — required for standard `import` statements.
        # Restricted to a whitelist of modules via _make_safe_import().
        '__import__': _make_safe_import(),
        # Types
        'True': True, 'False': False, 'None': None,
        'int': int, 'float': float, 'str': str, 'bytes': bytes,
        'bool': bool, 'list': list, 'dict': dict, 'tuple': tuple,
        'set': set, 'frozenset': frozenset, 'bytearray': bytearray,
        # Functions
        'len': len, 'range': range, 'enumerate': enumerate, 'zip': zip,
        'map': map, 'filter': filter, 'sorted': sorted, 'reversed': reversed,
        'min': min, 'max': max, 'sum': sum, 'abs': abs, 'round': round,
        'isinstance': isinstance, 'issubclass': issubclass, 'type': type,
        'hasattr': hasattr, 'getattr': getattr, 'setattr': setattr,
        'print': print, 'repr': repr, 'id': id, 'hash': hash,
        'iter': iter, 'next': next, 'callable': callable,
        'chr': chr, 'ord': ord, 'hex': hex,
        'ValueError': ValueError, 'TypeError': TypeError,
        'KeyError': KeyError, 'IndexError': IndexError,
        'RuntimeError': RuntimeError, 'Exception': Exception,
        'StopIteration': StopIteration,
        'super': super, 'property': property, 'staticmethod': staticmethod,
        'classmethod': classmethod, 'object': object,
    }
    namespace = {
        "__builtins__": _SAFE_BUILTINS,
        "io": io,
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
