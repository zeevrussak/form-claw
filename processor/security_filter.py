#!/usr/bin/env python3
"""
Security Filter — Prompt injection detection for email content.

Scans email components (subject, body, attachment text) for patterns
indicative of prompt injection attacks before LLM processing.
"""

import re
from dataclasses import dataclass, field
from typing import List, Tuple

_BLOCK_THRESHOLD = 0.70


@dataclass
class SecurityVerdict:
    blocked: bool = False
    risk_score: float = 0.0
    flags: List[str] = field(default_factory=list)
    summary: str = ""


# (pattern, risk_weight, flag_label)
_PATTERNS: List[Tuple[re.Pattern, float, str]] = [
    # Direct LLM manipulation
    (re.compile(r"ignore\s+(all\s+)?previous\s+instructions", re.I), 0.9, "direct_override"),
    (re.compile(r"disregard\s+(all\s+)?(prior|above|previous)", re.I), 0.9, "direct_override"),
    (re.compile(r"you\s+are\s+now\s+(a|an)", re.I), 0.8, "role_hijack"),
    (re.compile(r"act\s+as\s+(a|an|if)", re.I), 0.6, "role_hijack"),
    (re.compile(r"system\s*prompt", re.I), 0.7, "system_probe"),
    (re.compile(r"repeat\s+(your|the)\s+(system|initial)", re.I), 0.8, "system_probe"),

    # Data exfiltration
    (re.compile(r"send\s+(all\s+)?data\s+to", re.I), 0.9, "exfiltration"),
    (re.compile(r"include\s+(the\s+)?api\s*key", re.I), 0.9, "exfiltration"),
    (re.compile(r"(output|print|reveal)\s+(all\s+)?(secret|key|password|token)", re.I), 0.9, "exfiltration"),

    # Form-specific attacks
    (re.compile(r"fill\s+every\s+field\s+with", re.I), 0.7, "form_attack"),
    (re.compile(r"forge\s+(a\s+)?signature", re.I), 0.8, "form_attack"),
    (re.compile(r"change\s+the\s+(id|identity|name)\s+to", re.I), 0.7, "form_attack"),

    # Encoded / obfuscated
    (re.compile(r"base64[:\s]|atob\(", re.I), 0.5, "encoded_content"),
    (re.compile(r"\\u[0-9a-fA-F]{4}", re.I), 0.4, "encoded_content"),
    (re.compile(r"eval\s*\(", re.I), 0.8, "code_injection"),
    (re.compile(r"exec\s*\(", re.I), 0.8, "code_injection"),
    (re.compile(r"import\s+os|import\s+subprocess|import\s+shutil", re.I), 0.9, "code_injection"),

    # Hebrew variants
    (re.compile(r"התעלם\s+מכל\s+ההוראות", re.I), 0.9, "hebrew_override"),
    (re.compile(r"התנהג\s+כאילו", re.I), 0.7, "hebrew_role_hijack"),
    (re.compile(r"זייף\s+(את\s+)?החתימה", re.I), 0.8, "hebrew_form_attack"),
    (re.compile(r"שלח\s+(את\s+)?המידע", re.I), 0.8, "hebrew_exfiltration"),
]


def scan_text(text: str) -> SecurityVerdict:
    """Scan a single text for injection patterns."""
    if not text or not text.strip():
        return SecurityVerdict()

    flags = []
    max_risk = 0.0

    for pattern, weight, label in _PATTERNS:
        if pattern.search(text):
            flags.append(label)
            max_risk = max(max_risk, weight)

    blocked = max_risk >= _BLOCK_THRESHOLD
    return SecurityVerdict(
        blocked=blocked,
        risk_score=max_risk,
        flags=flags,
        summary=f"Risk {max_risk:.0%}, flags: {', '.join(flags)}" if flags else "clean",
    )


def scan_email_content(
    subject: str = "",
    body: str = "",
    attachment_text: str = "",
) -> SecurityVerdict:
    """Scan all email parts and return combined verdict."""
    parts = [
        ("subject", subject),
        ("body", body),
        ("attachment", attachment_text),
    ]

    all_flags = []
    max_risk = 0.0

    for label, text in parts:
        v = scan_text(text)
        if v.flags:
            all_flags.extend(f"{label}:{f}" for f in v.flags)
            max_risk = max(max_risk, v.risk_score)

    blocked = max_risk >= _BLOCK_THRESHOLD
    return SecurityVerdict(
        blocked=blocked,
        risk_score=max_risk,
        flags=all_flags,
        summary=f"Risk {max_risk:.0%}, flags: {', '.join(all_flags)}" if all_flags else "clean",
    )
