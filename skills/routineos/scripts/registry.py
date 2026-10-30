"""Capability registry loading and validation. Standard library only (Python 3.11+)."""
import datetime
import os
import tomllib

STATUSES = ("pilot-verified", "docs-stated", "conflict", "unverified", "broken")
DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "registry", "capabilities.toml")


class RegistryError(Exception):
    """Raised for an unreadable or malformed registry file."""


def load(path):
    try:
        with open(path, "rb") as fh:
            data = tomllib.load(fh)
    except FileNotFoundError:
        raise RegistryError(f"registry file not found: {path}")
    except tomllib.TOMLDecodeError as exc:
        raise RegistryError(f"malformed TOML in {path}: {' '.join(str(exc).split())}")
    except OSError as exc:
        raise RegistryError(f"cannot read {path}: {' '.join(str(exc).split())}")
    records = data.get("capability", [])
    if not isinstance(records, list) or not all(isinstance(r, dict) for r in records):
        raise RegistryError(f"{path}: [[capability]] must be an array of tables")
    return records


def _has(rec, key):
    value = rec.get(key)
    return bool(value) if isinstance(value, (list, str)) else value is not None


def validate(records):
    problems = []
    seen = set()
    for i, rec in enumerate(records):
        rid = rec.get("id")
        label = rid if isinstance(rid, str) and rid else f"#{i}"
        if not isinstance(rid, str) or not rid:
            problems.append(f"capability {label}: missing id")
        elif rid in seen:
            problems.append(f"capability {label}: duplicate id")
        else:
            seen.add(rid)
        if not isinstance(rec.get("claim"), str) or not rec["claim"].strip():
            problems.append(f"capability {label}: missing claim")
        status = rec.get("status")
        if status not in STATUSES:
            problems.append(f"capability {label}: unknown status '{status}'")
            continue
        if status == "pilot-verified" and not _has(rec, "tested"):
            problems.append(f"capability {label}: pilot-verified needs a tested field")
        if status == "docs-stated":
            for key in ("source", "checked"):
                if not _has(rec, key):
                    problems.append(f"capability {label}: docs-stated needs a {key} field")
        if status == "conflict":
            for key in ("tested", "docs"):
                if not _has(rec, key):
                    problems.append(f"capability {label}: conflict needs a {key} field")
    return problems


def by_id(records):
    return {r["id"]: r for r in records if "id" in r}


def stale(records, today, days=14):
    now = datetime.date.fromisoformat(today)
    out = []
    for rec in records:
        checked = rec.get("checked")
        try:
            age = (now - datetime.date.fromisoformat(str(checked))).days
        except ValueError:
            out.append(rec.get("id"))
            continue
        if age > days:
            out.append(rec.get("id"))
    return out
