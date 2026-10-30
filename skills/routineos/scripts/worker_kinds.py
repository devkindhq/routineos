"""Worker kinds: the fixed catalog a joiner's routine is built from. Standard library only.

A join card names a kind and supplies parameters; the prompt text always comes from the files in
assets/workers/, never from the card. render_prompt has no parameter for the card's summary or
label, so that text cannot reach a model as instructions.
"""
import os
import re

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "workers")
HEADER = "worker-header.md"

KINDS = {
    "mail-draft": {
        "label": "Mail drafts",
        "does": "creates a draft in your mailbox for each matching item; you send it yourself",
        "reads": "the Desk's matching items and your own drafts",
        "params": {"mailbox": "email"},
        "connectors": ("gmail",),
        "acts_externally": False,
        "gate": "none",
        "prompt": "mail-draft.md",
    },
    "mail-send": {
        "label": "Mail sender",
        "does": "creates a draft in your mailbox for each matching item and sends it after you approve",
        "reads": "the Desk's matching items, your own drafts and your decisions on the Desk",
        "params": {"mailbox": "email"},
        "connectors": ("gmail",),
        "acts_externally": True,
        "gate": "send",
        "prompt": "mail-send.md",
    },
}


NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,40}$")
LANE_KEY_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*--[a-z0-9]+(-[a-z0-9]+)*$")
ONE_PLACEHOLDER_RE = re.compile(r"^\{([a-z][a-z0-9_]{0,39})\}$")
PLAIN_EQUALS_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
URL_RE = re.compile(r"^https://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{1,500}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
UNSAFE_RE = re.compile(r"[`{}\x00-\x1f\x7f]")
TOKEN_RE = re.compile(r"\{([a-z_]+)\}")
MAX_VALUE = 200


class KindError(Exception):
    """Raised for an unknown kind or a prompt that cannot be filled."""


def kind(kind_id):
    if kind_id not in KINDS:
        raise KindError(f"unknown worker kind '{kind_id}'")
    return KINDS[kind_id]


def _read(name):
    with open(os.path.join(ASSETS, name), encoding="utf-8") as fh:
        return fh.read()


def _safe(name, value):
    value = str(value)
    if UNSAFE_RE.search(value) or len(value) > MAX_VALUE * 3:
        raise KindError(f"{name} may not contain a backtick, a curly brace or a line break")
    return value


# The joiner's Desk id, pinned in the prompt: a run that read it from workers/<laneKey> would trust a doc any
# Contributor can rewrite.
BY_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def render_prompt(kind_id, *, desk_url, lane_key, match, params, by, gate_email=None):
    """The header then the kind's body, every placeholder filled from checked values.

    Every value is checked here, whatever the caller already checked, and the fill is a single
    pass, so text that a value inserts is never scanned for placeholders again.
    """
    k = kind(kind_id)
    if k["gate"] == "send" and not gate_email:
        raise KindError(f"worker kind '{kind_id}' needs a gate email")
    if not URL_RE.match(str(desk_url)):
        raise KindError("desk url must be an https link")
    if not BY_RE.match(str(by)):
        raise KindError("by must be your Desk id: 1 to 64 letters, digits, _ or -")
    if not LANE_KEY_RE.match(str(lane_key)):
        raise KindError("lane key must be a lane id, two dashes and a slug")
    if not isinstance(match, dict) or not all(NAME_RE.match(str(match.get(f, ""))) for f in ("type", "field")):
        raise KindError(f"match type and field must match {NAME_RE.pattern}")
    for name, value in params.items():
        if not NAME_RE.match(str(name)) or len(str(value)) > MAX_VALUE:
            raise KindError(f"param '{name}' is not a plain name and value")
        _safe(f"param '{name}'", value)
    equals = str(match.get("equals", ""))
    one = ONE_PLACEHOLDER_RE.match(equals)
    if one:
        if one.group(1) not in params:
            raise KindError(f"match equals names an undeclared param '{one.group(1)}'")
        match_value = str(params[one.group(1)])
    elif PLAIN_EQUALS_RE.match(equals):
        match_value = equals
    else:
        raise KindError("match equals must be exactly one {param} or one plain token of at most 40 letters, digits, _ or -")
    if gate_email is not None and not (EMAIL_RE.match(str(gate_email)) and len(str(gate_email)) <= MAX_VALUE):
        raise KindError("gate email must be an email address")
    values = {
        "desk_url": desk_url,
        "lane_key": lane_key,
        "by": by,
        "match_type": match["type"],
        "match_field": match["field"],
        "match_value": match_value,
        "mailbox": params.get("mailbox", ""),
        "gate_email": gate_email or "",
    }
    values = {name: _safe(name, v) for name, v in values.items()}
    text = _read(HEADER).rstrip() + "\n\n" + _read(k["prompt"])
    return TOKEN_RE.sub(lambda m: values.get(m.group(1), m.group(0)), text)
