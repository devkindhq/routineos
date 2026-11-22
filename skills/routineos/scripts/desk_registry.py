"""The Desk component registry: load it, lint it and render its reference block (stdlib only).

registry.json describes what the Desk draws, by id and purpose: its building blocks (kind core), the built-in pages
(kind page) and, per routine, the routine's own field cell components (kind custom). The lint keeps that list,
the helpers a custom component gets and desk-components.md in step.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib

import blueprint
import definition
import desk_libs
import desk_raw

REGISTRY = os.path.join("assets", "desk", "components", "registry.json")
DESK = os.path.join("assets", "desk")
COMPONENT_UI = os.path.join(DESK, "app", "componentUi.js")
DOC = os.path.join("references", "desk-components.md")

GEN_START = "<!-- generated:start -->"
GEN_END = "<!-- generated:end -->"

ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,31}$")
KINDS = ("core", "page", "custom")
PROP_TYPES = ("text", "bool", "int", "icon", "choice", "view", "filter", "ref")
REGISTRY_KEYS = ("version", "components")
# factory: on a core entry, the componentUi() helper a custom component calls; on a custom entry, its function.
# fallback only comes in from a custom component's manifest.
ENTRY_KEYS = ("id", "kind", "factory", "summary", "fallback", "props", "a11y", "since")
REQUIRED_KEYS = ("id", "kind", "summary", "since")
PROP_KEYS = ("type", "required", "choices")
SUMMARY_MAX = 120

STRING_RE = re.compile(r'"(?:[^"\\\n]|\\.)*"|\'(?:[^\'\\\n]|\\.)*\'|`[^`]*`')
UI_RETURN_RE = re.compile(r"export function componentUi\(\)\s*\{\s*return\s*\{(.*?)\n  \};", re.S)


def load(root, routine=None):
    """The registry under the skill root; with `routine`, that routine's custom components join it as kind custom."""
    with open(os.path.join(root, REGISTRY), encoding="utf-8") as f:
        reg = json.load(f)
    if routine and isinstance(reg, dict) and isinstance(reg.get("components"), list):
        reg["components"] = reg["components"] + [_custom_entry(c) for c in custom_components(routine)]
    return reg


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _label(entry):
    return f"component '{entry.get('id')}'" if isinstance(entry, dict) else "component"


def _check_props(label, props):
    if not isinstance(props, dict):
        return [f"{label}: props must be an object"]
    problems = []
    for name, spec in props.items():
        where = f"{label} prop '{name}'"
        if not isinstance(spec, dict):
            problems.append(f"{where}: must be an object")
            continue
        for key in sorted(set(spec) - set(PROP_KEYS)):
            problems.append(f"{where}: unknown key '{key}'")
        ptype = spec.get("type")
        if ptype not in PROP_TYPES:
            hint = "; use choice" if ptype == "enum" else ""
            problems.append(f"{where}: type '{ptype}' is not one of {', '.join(PROP_TYPES)}{hint}")
        choices = spec.get("choices")
        if ptype == "choice":
            if not (isinstance(choices, list) and choices and all(isinstance(c, str) and c for c in choices)):
                problems.append(f"{where}: a choice prop needs a non-empty choices list")
        elif choices is not None and ptype in PROP_TYPES:
            problems.append(f"{where}: choices only go with type choice")
        if "required" in spec and not isinstance(spec["required"], bool):
            problems.append(f"{where}: required must be true or false")
    return problems


def _check_entry(entry):
    label = _label(entry)
    if not isinstance(entry, dict):
        return [f"{label}: each entry must be an object"]
    problems = []
    for key in sorted(set(entry) - set(ENTRY_KEYS)):
        problems.append(f"{label}: unknown key '{key}'")
    for key in REQUIRED_KEYS:
        if key not in entry:
            problems.append(f"{label}: '{key}' is required")
    cid = entry.get("id")
    if not (isinstance(cid, str) and ID_RE.match(cid)):
        problems.append(f"{label}: id must match {ID_RE.pattern}")
    kind = entry.get("kind")
    if kind not in KINDS:
        problems.append(f"{label}: kind must be one of {', '.join(KINDS)}")
    factory = entry.get("factory")
    if "factory" in entry and not (isinstance(factory, str) and factory):
        problems.append(f"{label}: factory must be a name")
    elif kind == "custom" and isinstance(cid, str) and factory != "component_" + cid.replace("-", "_"):
        problems.append(f"{label}: a custom factory is component_{cid.replace('-', '_')}")
    elif kind == "page" and "factory" in entry:
        problems.append(f"{label}: a page has no factory; the Desk draws it from its route")
    if "fallback" in entry and not (isinstance(entry["fallback"], str) and entry["fallback"]):
        problems.append(f"{label}: fallback must be an element name or 'same'")
    if kind == "custom":
        if "props" in entry:
            problems.append(f"{label}: a custom component has no props; the field cell slot fixes them")
    elif "props" not in entry:
        problems.append(f"{label}: 'props' is required")
    else:
        problems += _check_props(label, entry["props"])
    summary = entry.get("summary")
    if "summary" in entry:
        if not isinstance(summary, str) or not summary:
            problems.append(f"{label}: summary must be text")
        else:
            if len(summary) >= SUMMARY_MAX:
                problems.append(f"{label}: summary must be under {SUMMARY_MAX} characters")
            problems += definition.copy_problems(f"{label} summary", summary)
    for key in ("a11y", "since"):
        if key in entry and not isinstance(entry[key], str):
            problems.append(f"{label}: {key} must be text")
    if isinstance(entry.get("a11y"), str):
        problems += definition.copy_problems(f"{label} a11y", entry["a11y"])
    return problems


def check_schema(reg):
    """Check 1: the registry has the documented shape."""
    if not isinstance(reg, dict):
        return ["registry.json: must be an object"]
    problems = [f"registry.json: unknown key '{k}'" for k in sorted(set(reg) - set(REGISTRY_KEYS))]
    if reg.get("version") != 1:
        problems.append("registry.json: version must be 1")
    comps = reg.get("components")
    if not isinstance(comps, list):
        return problems + ["registry.json: components must be a list"]
    seen = set()
    for entry in comps:
        problems += _check_entry(entry)
        cid = entry.get("id") if isinstance(entry, dict) else None
        if isinstance(cid, str):
            if cid in seen:
                problems.append(f"component '{cid}': declared more than once")
            seen.add(cid)
    return problems


def ui_helpers(root):
    """The names of the helpers componentUi() in app/componentUi.js gives a custom component."""
    m = UI_RETURN_RE.search(_read(os.path.join(root, COMPONENT_UI)))
    return set(re.findall(r"(\w+)\s*:", m.group(1))) if m else set()


def check_factories(root, reg):
    """Check 2: a core entry's factory is a helper that componentUi() gives a custom component."""
    if not os.path.exists(os.path.join(root, COMPONENT_UI)):
        return [f"{COMPONENT_UI.replace(os.sep, '/')}: missing"]
    have = ui_helpers(root)
    return [f"{_label(c)}: factory '{c.get('factory')}' is not a helper componentUi() gives a custom component"
            for c in reg.get("components", [])
            if isinstance(c, dict) and c.get("kind") == "core" and "factory" in c and c.get("factory") not in have]


def markdown(reg):
    """The generated block of desk-components.md: per component, its summary, a props table and one usage line."""
    out = []
    comps = [c for c in reg.get("components", []) if isinstance(c, dict)]
    for kind, title in (("core", "Core components"), ("page", "Pages"), ("custom", "Custom components")):
        group = [c for c in comps if c.get("kind") == kind]
        if not group:
            continue
        out += [f"## {title}", ""]
        for c in group:
            out += [f"### {c.get('id')}", "", str(c.get("summary", "")), ""]
            props = c.get("props") if isinstance(c.get("props"), dict) else {}
            if props:
                out += ["| Prop | Type | Required |", "|---|---|---|"]
                for name, spec in props.items():
                    spec = spec if isinstance(spec, dict) else {}
                    ptype = str(spec.get("type", ""))
                    if isinstance(spec.get("choices"), list):
                        ptype += ": " + ", ".join(str(x) for x in spec["choices"])
                    out.append(f"| `{name}` | {ptype} | {'yes' if spec.get('required') else 'no'} |")
                out.append("")
            elif kind != "custom":
                out += ["No props.", ""]
            if c.get("a11y"):
                out += [f"Accessibility: {c['a11y']}", ""]
            if kind == "core" and c.get("factory"):
                out += [f"Use: `ui.{c.get('factory')}(...)` in a custom component; it builds a plain element.", ""]
            elif kind == "core":
                out += ["Use: the Desk draws it on its pages; a custom component cannot call it.", ""]
            elif kind == "page":
                out += [f"Use: the `{c.get('id')}` default module. Place it with modules; never call it from a "
                        "component.", ""]
            else:
                out += [f"Use: name `{c.get('id')}` in a view module's `fields` to draw that field's cell.", ""]
    return "\n".join(out).rstrip("\n") + "\n"


def check_doc(root, reg):
    """Check 3: the generated block of desk-components.md matches registry.json."""
    path = os.path.join(root, DOC)
    rel = DOC.replace(os.sep, "/")
    if not os.path.exists(path):
        return [f"{rel}: missing"]
    text = _read(path)
    if GEN_START not in text or GEN_END not in text:
        return [f"{rel}: no generated block ({GEN_START} ... {GEN_END})"]
    block = text[text.index(GEN_START) + len(GEN_START):text.index(GEN_END)]
    if block.strip("\n") != markdown(reg).strip("\n"):
        return [f"{rel}: the generated block is stale; run routineos desk components --markdown"]
    return []


def lint(root, routine=None):
    """Every registry problem under the skill root, and with `routine` its custom components; [] when clean."""
    try:
        reg = load(root)
    except (OSError, ValueError) as e:
        return [f"registry.json: cannot be read ({e})"]
    problems = check_schema(reg)
    if not isinstance(reg, dict) or not isinstance(reg.get("components"), list):
        return problems
    problems += check_factories(root, reg) + check_doc(root, reg)
    if routine:
        problems += lint_routine(reg, routine)
    return problems


def lint_routine_only(root, routine):
    """Only `routine`'s own checks (its custom components and module fields maps); the registry is read for core
    ids only, so plugin-internal state never fails a routine's lint."""
    try:
        reg = load(root)
    except (OSError, ValueError) as e:
        return [f"registry.json: cannot be read ({e})"]
    return lint_routine(reg if isinstance(reg, dict) else {}, routine)


# Custom field cell components (spec 4.6): <routine>/desk/components/<id>/component.json and <id>.js.

COMPONENTS_DIR = os.path.join("desk", "components")
# "wa" is accepted and ignored: manifests written before the Mantine Desk carry it.
CUSTOM_KEYS = ("id", "kind", "slot", "factory", "summary", "why", "wa", "fallback", "since",
               "types", "view", "title", "nav", "verbs", "placement", "prefs", "raw")
CUSTOM_REQUIRED = ("id", "kind", "slot", "factory", "summary", "why", "fallback", "since")
SLOTS = ("field-cell", "record-section", "panel", "page")
RAW_SLOTS = ("record-section", "panel", "page")
# Extra manifest keys each slot may carry, and the ones it must carry.
SLOT_KEYS = {"field-cell": (), "record-section": ("types", "title", "verbs", "placement", "prefs"),
             "panel": ("view", "title", "verbs", "prefs"), "page": ("title", "nav", "verbs", "prefs")}
PLACEMENTS = ("top", "after-summary", "after-fields")
VERBS = ("decide", "comment", "saveField", "drop", "keep", "request", "upsert")
SLOT_REQUIRED = {"field-cell": (), "record-section": ("types",), "panel": ("view",), "page": ("title",)}
INTERACTIVE_SLOTS = ("record-section", "panel", "page")
WHY_MIN = 40

# HTML sinks the Desk never uses; test_desk_bundle scans the bundled page for these.
HTML_SINKS = ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "createContextualFragment",
              "DOMParser")

# APIs a custom component may not touch (spec 4.6), as (name, pattern) pairs.
BANNED_APIS = tuple((name, re.compile(r"\b" + re.escape(name).replace(r"\.", r"\s*\.\s*") + r"\b"))
                    for name in HTML_SINKS) + (
    ("eval", re.compile(r"\beval\s*\(")),
    ("Function(", re.compile(r"\bFunction\s*\(")),
    ("import(", re.compile(r"\bimport\s*\(")),
    ("fetch(", re.compile(r"\bfetch\s*\(")),
    ("XMLHttpRequest", re.compile(r"\bXMLHttpRequest\b")),
    ("WebSocket", re.compile(r"\bWebSocket\b")),
    ("localStorage", re.compile(r"\blocalStorage\b")),
    ("sessionStorage", re.compile(r"\bsessionStorage\b")),
    ('setAttribute("on', re.compile(r"\bsetAttribute\s*\(\s*[\"'`]on", re.I)),
    ("on* handler assignment", re.compile(r"\.on[a-z]+\s*=(?!=)")),
    ("claude.", re.compile(r"\bclaude\s*\.")),
)
MAX_COMPONENT_BYTES = 64 * 1024  # a code page is a small drawing function; more than this is a sign it should be a spec page
URL_LITERAL_RE = re.compile(r"://|^\s*(?:javascript|data|vbscript|blob):", re.I)
FUNCTION_RE = re.compile(r"^function\s+([A-Za-z_$][\w$]*)\s*\(", re.M)
# The checks above and below are a text lint: a guard against mistakes, not a security boundary. A determined author
# can get past any of them; the bundler keeps each component in its own script so a mistake costs only that
# component. These also catch the common indirect forms (a key built at run time, a tag or attribute name split
# across literals). False positives are fine.
COMPUTED_ACCESS_RE = re.compile(r"""(?:[\w$)\]]|\?\.)\s*\[(?!\s*(?:\d+|"[^"\\\n]*"|'[^'\\\n]*')\s*\])""")
RISKY_WORD_RE = re.compile(r"^\s*(script|iframe|object|embed|srcdoc)\b", re.I)
# Host objects and reflection a component never needs; named anywhere outside a comment, they fail the lint.
BANNED_IDENTIFIERS = ("constructor", "Reflect", "navigator", "location", "document", "globalThis", "window",
                      "Function", "eval", "importScripts", "ownerDocument", "defaultView", "contentWindow",
                      "contentDocument", "fetch", "Image", "createElement", "createElementNS", "setAttribute",
                      "setAttributeNS", "setAttributeNode", "sendBeacon", "postMessage", "EventSource", "Worker",
                      "SharedWorker")
BANNED_IDENTIFIER_RE = re.compile(r"(?<![\w$])(" + "|".join(BANNED_IDENTIFIERS) + r")(?![\w$])")
# Other names for the global object, and the bare host API. Fine as a property name (x.top) or an object key (top:).
BANNED_GLOBALS = ("self", "top", "parent", "frames", "opener", "claude")
BANNED_GLOBAL_RE = re.compile(r"(?<![\w$.])(" + "|".join(BANNED_GLOBALS) + r")(?![\w$])(?!\s*:(?!:))")
REGEX_AFTER = set("(,=:[!&|?{};+-*%<>~^")
REGEX_AFTER_WORDS = ("return", "typeof", "case", "do", "else", "in", "instanceof", "new", "void", "delete", "throw",
                     "yield", "await")
ON_KEY_RE = re.compile(r"""(?:["'`]on[a-z]*["'`]|(?<![\w$.])on(?!lyMarked(?![\w$]))[a-z]+)\s*:(?!:)|\[\s*["'`]on[a-z]*["'`]""", re.I)


TYPE_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")


def pages_enabled(routine):
    """True when routine.toml opts in to custom pages with [desk] pages = true."""
    try:
        with open(os.path.join(routine, "routine.toml"), "rb") as f:
            data = tomllib.load(f)
    except (OSError, ValueError):
        return False
    desk = data.get("desk")
    return isinstance(desk, dict) and desk.get("pages") is True


READ_RE = re.compile(r"\bctx\s*\.\s*(read|list|watch)\b|\bctx\s*\.\s*store\s*\.\s*(get|list)\b")
WHERE = {"field-cell": "a table cell", "record-section": "a card on the record page", "panel": "a card on Today",
         "page": "its own page"}


def extension_rows(routine_dir):
    """One row per component folder for the permission screen. The verbs are the manifest's declared list; the
    manifest and the code pass the same lint as `desk lint` first, and a folder that fails is a row with
    invalid=True and its problems, never one built from its own claims."""
    rows = []
    for d in _component_dirs(routine_dir):
        folder = os.path.basename(d)
        problems = lint_component(d, _routine_definition(routine_dir))
        m = _manifest(d)
        if m is not None and m.get("slot") == "page" and not pages_enabled(routine_dir):
            problems.append(f"component '{folder}': a page needs [desk] pages = true in routine.toml")
        if problems or m is None:
            rows.append({"id": folder, "invalid": True, "problems": problems})
            continue
        raw = is_raw(m)
        try:
            text = "" if raw else _read(os.path.join(d, folder + ".js"))
        except OSError:
            text = ""
        slot = m["slot"]
        row = {"id": folder, "invalid": False, "slot": slot, "where": WHERE.get(slot, "?"),
               "verbs": list(m.get("verbs") or []), "prefs": m.get("prefs") is True,
               "placement": m.get("placement", "after-summary") if slot == "record-section" else None, "hash": component_hash(d),
               "reads": sorted({a or b for a, b in READ_RE.findall(text)}),
               "types": list(m["types"]) if slot == "record-section" else
               [m["view"]["type"]] if slot == "panel" else []}
        if raw:
            row.update(raw=True, libraries=raw_libraries(d))
        rows.append(row)
    return rows


APPROVALS_FILE = "approvals.json"


def is_raw(manifest):
    """True when the manifest opts in to a raw React page with raw: true."""
    return isinstance(manifest, dict) and manifest.get("raw") is True


def raw_source(comp_dir):
    """Path of the one raw page source (<id>.jsx or <id>.js) in comp_dir, or None when there is none or both."""
    folder = os.path.basename(os.path.normpath(comp_dir))
    found = [os.path.join(comp_dir, folder + ext) for ext in (".jsx", ".js")
             if os.path.isfile(os.path.join(comp_dir, folder + ext))]
    return found[0] if len(found) == 1 else None


def raw_libraries(comp_dir):
    """Sorted "specifier@version" for each registry library the raw page imports; [] when it cannot be read."""
    path = raw_source(comp_dir)
    if not path:
        return []
    try:
        specifiers = desk_raw.rewrite_module(_read(path), os.path.basename(path), desk_libs.load_exports()).specifiers
        have = desk_libs.versions(desk_libs.load_libraries())
    except (OSError, ValueError, KeyError, desk_libs.LibraryError):
        return []
    # The compiled thunk always runs through DESK_LIB.react (the prologue), so react is an implicit import.
    return sorted("%s@%s" % (s, have.get(s, "?")) for s in set(specifiers) | {"react"})


def component_hash(comp_dir):
    """sha256 of a component's manifest bytes, a NUL and its code bytes: what the owner approves. A raw page adds its
    .jsx bytes, the transformer id and the versions of the libraries it imports, so a change to any of them is a new
    approval."""
    folder = os.path.basename(os.path.normpath(comp_dir))
    h = hashlib.sha256()
    for name in ("component.json", folder + ".js"):
        try:
            with open(os.path.join(comp_dir, name), "rb") as f:
                h.update(f.read())
        except OSError:
            pass
        h.update(b"\0")
    if is_raw(_manifest(comp_dir)):
        try:
            with open(os.path.join(comp_dir, folder + ".jsx"), "rb") as f:
                h.update(f.read())
        except OSError:
            pass
        h.update(b"\0" + desk_raw.TRANSFORMER_ID.encode("utf-8") + b"\0" + ",".join(raw_libraries(comp_dir)).encode("utf-8") + b"\0")
    return h.hexdigest()


def _approvals_path(routine_dir):
    return os.path.join(routine_dir, "desk", APPROVALS_FILE)


def read_approvals(routine_dir):
    """{component id: approved hash}, empty when the record is missing or unreadable."""
    try:
        data = json.loads(_read(_approvals_path(routine_dir)))
        comps = data.get("components")
    except (OSError, ValueError, AttributeError):
        return {}
    return {k: v for k, v in comps.items() if isinstance(v, str)} if isinstance(comps, dict) else {}


def write_approvals(routine_dir, rows):
    """Record the hash of every valid row as approved. Returns the path written."""
    path = _approvals_path(routine_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    comps = {r["id"]: r["hash"] for r in rows if not r.get("invalid")}
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "components": comps}, f, indent=2, sort_keys=True)
        f.write("\n")
    return path


def unapproved_extensions(routine_dir):
    """Ids of interactive-slot components (record-section, panel, page) whose current hash is not the approved one."""
    approved = read_approvals(routine_dir)
    out = []
    for d in _component_dirs(routine_dir):
        m = _manifest(d) or {}
        if m.get("slot") in INTERACTIVE_SLOTS:
            folder = os.path.basename(d)
            if approved.get(folder) != component_hash(d):
                out.append(folder)
    return out


def factory_name(cid):
    return "component_" + cid.replace("-", "_")


def _component_dirs(routine):
    base = os.path.join(routine, COMPONENTS_DIR)
    if not os.path.isdir(base):
        return []
    return [os.path.join(base, n) for n in sorted(os.listdir(base)) if os.path.isdir(os.path.join(base, n))]


def _manifest(comp_dir):
    """component.json as a dict, or None when it is missing or not an object."""
    try:
        m = json.loads(_read(os.path.join(comp_dir, "component.json")))
    except (OSError, ValueError):
        return None
    return m if isinstance(m, dict) else None


def custom_components(routine_dir):
    """A routine's custom components, sorted by folder: each its manifest plus id, factory and path."""
    out = []
    for d in _component_dirs(routine_dir):
        m = _manifest(d) or {}
        cid = m.get("id") if isinstance(m.get("id"), str) else os.path.basename(d)
        if is_raw(m):
            out.append(dict(m, id=cid, factory=None, path=d, source=raw_source(d)))
            continue
        factory = m.get("factory") if isinstance(m.get("factory"), str) else factory_name(cid)
        out.append(dict(m, id=cid, factory=factory, path=d))
    return out


def _custom_entry(c):
    """A custom component as a registry entry (kind custom, no slot, why or path; a raw page has no factory)."""
    entry = {k: c[k] for k in ENTRY_KEYS if k in c and k != "props" and not (k == "factory" and c[k] is None)}
    entry["kind"] = "custom"
    return entry


def routine_names(defn):
    """{literal: what it names} for a routine definition: type ids, field ids and source names."""
    names = {}
    if not isinstance(defn, dict):
        return names
    types = defn.get("types") if isinstance(defn.get("types"), dict) else {}
    for tid, t in types.items():
        names.setdefault(tid, "type id")
        fields = t.get("fields") if isinstance(t, dict) and isinstance(t.get("fields"), dict) else {}
        for fid in fields:
            names.setdefault(fid, "field id")
    views = list(defn.get("views") or []) if isinstance(defn.get("views"), list) else []
    desk = defn.get("desk") if isinstance(defn.get("desk"), dict) else {}
    for m in desk.get("modules") or [] if isinstance(desk.get("modules"), list) else []:
        if isinstance(m, dict) and isinstance(m.get("view"), dict):
            views.append(m["view"])
    for v in views:
        filters = v.get("filters") if isinstance(v, dict) and isinstance(v.get("filters"), dict) else {}
        src = filters.get("source")
        for name in ([src] if isinstance(src, str) else src if isinstance(src, list) else []):
            if isinstance(name, str):
                names.setdefault(name, "source name")
    return names


def _literals(text):
    return [lit[1:-1] for lit in STRING_RE.findall(text)]


def _check_custom_manifest(m, folder):
    label = _label(m)
    problems = []
    for key in sorted(set(m) - set(CUSTOM_KEYS)):
        problems.append(f"{label}: unknown key '{key}'" if key != "props" else
                        f"{label}: a custom component has no props; the field cell slot fixes them")
    raw = is_raw(m)
    if "raw" in m and not isinstance(m["raw"], bool):
        problems.append(f"{label}: raw must be true or false")
    for key in CUSTOM_REQUIRED:
        if key not in m and not (raw and key == "factory"):
            problems.append(f"{label}: '{key}' is required")
    if m.get("kind") != "custom":
        problems.append(f"{label}: kind must be custom")
    if raw:
        if "factory" in m:
            problems.append(f"{label}: a raw page has no factory; the Desk takes its default export")
        if m.get("slot") == "field-cell":
            problems.append(f"{label}: a raw page cannot be a field-cell; use {', '.join(RAW_SLOTS)}")
    # Shared checks (id, factory, fallback, summary, since) run on the registry shape of the entry.
    shared = {k: v for k, v in m.items() if k in ENTRY_KEYS and k not in ("kind", "props") and not (raw and k == "factory")}
    problems += [p for p in _check_entry(dict(shared, kind="custom"))
                 if "is required" not in p and "unknown key" not in p and not (raw and "a custom factory is" in p)]
    cid = m.get("id")
    if isinstance(cid, str) and cid != folder:
        problems.append(f"{label}: id must equal its folder name '{folder}'")
    slot = m.get("slot")
    if "slot" in m and slot not in SLOTS:
        problems.append(f"{label}: slot must be one of {', '.join(SLOTS)}")
    if slot in SLOTS:
        for key in ("types", "view", "title", "nav", "verbs", "placement", "prefs"):
            if key in m and key not in SLOT_KEYS[slot]:
                problems.append(f"{label}: '{key}' does not belong to a {slot}")
        for key in SLOT_REQUIRED[slot]:
            if key not in m:
                problems.append(f"{label}: a {slot} needs '{key}'")
        types = m.get("types")
        if "types" in m and not (isinstance(types, list) and types and
                                 all(isinstance(t, str) and TYPE_ID_RE.match(t) for t in types)):
            problems.append(f"{label}: types must be a non-empty list of entity type ids")
        view = m.get("view")
        if "view" in m and not (isinstance(view, dict) and isinstance(view.get("type"), str)
                                and TYPE_ID_RE.match(view["type"])
                                and isinstance(view.get("filters", []), list)):
            problems.append(f"{label}: view must be an object with a type id and an optional filters list")
        if "title" in m and not (isinstance(m["title"], str) and 0 < len(m["title"]) <= 60):
            problems.append(f"{label}: title must be text of 1 to 60 characters")
        verbs = m.get("verbs")
        if "verbs" in m and not (isinstance(verbs, list) and len(set(verbs)) == len(verbs)
                                 and all(isinstance(v, str) and v in VERBS for v in verbs)):
            problems.append(f"{label}: verbs must be a list without repeats of {', '.join(VERBS)}")
        if "nav" in m and not isinstance(m["nav"], bool):
            problems.append(f"{label}: nav must be true or false")
        if "placement" in m and m["placement"] not in PLACEMENTS:
            problems.append(f"{label}: placement must be one of {', '.join(PLACEMENTS)}")
        if "prefs" in m and not isinstance(m["prefs"], bool):
            problems.append(f"{label}: prefs must be true or false")
    if "fallback" in m and m.get("fallback") != "same":
        problems.append(f"{label}: fallback must be 'same'; the Desk draws the default cell text on any failure")
    why = m.get("why")
    if "why" in m and not (isinstance(why, str) and len(why.strip()) >= WHY_MIN):
        problems.append(f"{label}: why must say in at least {WHY_MIN} characters why the default cell text "
                        "does not serve this field")
    if isinstance(why, str):
        problems += definition.copy_problems(f"{label} why", why)
    return problems


def _scan_js(text, origins=False):
    """(code, uncommented): `text` without comments, with string, template and regex literal bodies blanked in `code`
    and kept in `uncommented`. A light scanner, not a parser: enough to count brackets and find names. With `origins`,
    a third value maps each `uncommented` index to its index in `text`, so a match there reports an exact line."""
    code, keep, stack, i, n = [], [], [], 0, len(text)
    org = []

    def last_token():
        tail = "".join(code[-40:]).rstrip()
        word = re.search(r"[\w$]+$", tail)
        return tail[-1:] if not word else word.group(0)

    def emit(c, k=None):
        code.append(c)
        k = c if k is None else k
        keep.append(k)
        org.extend(range(i, i + len(k)))

    def template(j):
        """Scan a template body from j; returns the index after its closing backtick or after a ${."""
        while j < n and text[j] != "`":
            if text[j] == "\\":
                j += 2
            elif text.startswith("${", j):
                stack.append("tpl")
                return j + 2
            else:
                j += 1
        return j + 1

    while i < n:
        c = text[i]
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            emit(" ")
            i = n if j < 0 else j + 2
        elif c in "\"'":
            j = i + 1
            while j < n and text[j] not in (c, "\n"):
                j += 2 if text[j] == "\\" else 1
            emit('""', text[i:j + 1])
            i = j + 1
        elif c == "`" or (c == "}" and stack and stack[-1] == "tpl"):
            if c == "}":
                stack.pop()
            j = template(i + 1)
            emit('""', text[i:j])
            i = j
        elif c == "/" and (not code or last_token() in REGEX_AFTER or last_token() in REGEX_AFTER_WORDS):
            j, in_class = i + 1, False
            while j < n and text[j] != "\n" and (in_class or text[j] != "/"):
                in_class = (in_class or text[j] == "[") and text[j] != "]"
                j += 2 if text[j] == "\\" else 1
            j += 1
            while j < n and (text[j].isalnum() or text[j] == "_"):
                j += 1
            emit('""', text[i:j])
            i = j
        else:
            if c == "{":
                stack.append("{")
            elif c == "}" and stack:
                stack.pop()
            emit(c)
            i += 1
    return ("".join(code), "".join(keep), org) if origins else ("".join(code), "".join(keep))


def _top_level(code):
    """The depth-0 text of `code` with each bracketed run kept as its bare brackets; None when brackets do not balance."""
    depth, top = 0, []
    for ch in code:
        if ch in "([{":
            if depth == 0:
                top.append(ch)
            depth += 1
        elif ch in ")]}":
            depth -= 1
            if depth < 0:
                return None
            if depth == 0:
                top.append(ch)
        elif depth == 0:
            top.append(ch)
    return "".join(top) if depth == 0 else None


def _parse_problems(text, rel):
    """node --check on the component as the bundler wraps it; skipped, with a note on stderr, when node is absent."""
    node = shutil.which("node")
    if not node:
        print(f"note: node is not on PATH; parse check skipped for {rel}", file=sys.stderr)
        return []
    fd, path = tempfile.mkstemp(suffix=".cjs")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write('(function () {\n"use strict";\n' + text + "\n})();\n")
        res = subprocess.run([node, "--check", path], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as exc:
        return [f"{rel}: parse check could not run ({exc})"]
    finally:
        os.remove(path)
    if res.returncode == 0:
        return []
    error = next((l for l in reversed(res.stderr.splitlines()) if "Error" in l), "a syntax error")
    return [f"{rel}: does not parse ({error.strip()})"]


STORE_USE_RE = re.compile(r"\bctx\s*\.\s*store\s*\.\s*([A-Za-z_$][\w$]*)")


ACTIONS_RE = re.compile(r"\bctx\s*\.\s*actions\b(\s*\.\s*([A-Za-z_$][\w$]*)\s*\()?")
BARE_CTX_RE = re.compile(r"(?<![\w$.])ctx\b(?!\s*\.)")
CTX_BRACKET_RE = re.compile(r"(?<![\w$.])ctx\s*\[")


PREF_RE = re.compile(r"\bctx\s*\.\s*(pref|setPref)\b")


MAX_PER_RULE = 5   # messages per rule per file, so a long page does not flood Claude's context
QUOTE_MAX = 60


def _line_at(text, pos):
    """1-based line of offset `pos`; counts \\n only, so a CRLF file reports the line an editor shows."""
    return text.count("\n", 0, pos) + 1


def _quote_at(text, start, end):
    """The whitespace-delimited token that holds text[start:end], trailing ; and , dropped, at most QUOTE_MAX long."""
    a, b = start, max(end, start)
    while a > 0 and not text[a - 1].isspace():
        a -= 1
    while b < len(text) and not text[b].isspace():
        b += 1
    return text[a:b].rstrip(";,")[:QUOTE_MAX]


def _problem(rel, text, pos, rule, quote, fix):
    """One lint problem as `{rel}:{line}: {rule}: "{quote}"; {fix}`; the line is left out when there is no position."""
    where = f"{rel}:{_line_at(text, pos)}" if pos is not None else rel
    quote = blueprint.terminal_safe(blueprint.redact(quote[:QUOTE_MAX]))
    return f'{where}: {rule}: "{quote}"; {fix}'


def _check_ctx_use(text, rel, factory, declared, prefs=False):
    """The host verbs a section, panel or page calls are the ones its manifest declares, and every use of ctx.actions
    is a direct ctx.actions.<verb>( call, so the declared list is what the code can reach."""
    problems = []
    _, unc, org = _scan_js(text, origins=True)
    head = re.search(r"function\s+" + re.escape(factory) + r"\s*\(\s*ctx\s*,", unc)
    if not head:
        problems.append(f"{rel}: the first parameter of {factory} must be named ctx")
    base = head.end() if head else 0
    body = unc[base:]

    def at(m, rule, fix, quote=None):
        raw = org[base + m.start()] if base + m.start() < len(org) else len(text)
        raw_end = org[base + m.end() - 1] + 1 if m.end() > m.start() and base + m.end() - 1 < len(org) else raw
        return _problem(rel, text, raw, rule, quote if quote is not None else _quote_at(text, raw, raw_end), fix), raw

    m = CTX_BRACKET_RE.search(body)
    if m:
        problems.append(at(m, "ctx[...]", "name the property directly")[0])
    m = BARE_CTX_RE.search(body)
    if m:
        problems.append(at(m, "ctx used without a property", "use ctx.<name> directly; no alias or destructuring")[0])
    used = {}
    for m in ACTIONS_RE.finditer(body):
        if not m.group(1):
            problems.append(at(m, "ctx.actions must be followed by .<verb>( at once", "no alias, no passing it on; call ctx.actions.<verb>( directly")[0])
        elif m.group(2) not in VERBS:
            problems.append(at(m, f"ctx.actions.{m.group(2)} is not a host verb", f"use one of {', '.join(VERBS)}")[0])
        else:
            used.setdefault(m.group(2), m)
    m = PREF_RE.search(body)
    if not prefs and m:
        problems.append(at(m, "ctx.pref or ctx.setPref without prefs", "set prefs: true in the manifest, or drop it")[0])
    for v in sorted(set(used) - set(declared)):
        problems.append(at(used[v], f"calls ctx.actions.{v} but the manifest does not declare it in verbs", "add it to verbs in the manifest, or drop the call")[0])
    return problems


def _check_custom_js(text, rel, factory, names, parse=True, names_apply=True):
    problems = []
    found = FUNCTION_RE.findall(text)
    if found != [factory]:
        have = ", ".join(found) or "none"
        problems.append(f"{rel}: must define exactly one top-level function, {factory} (found: {have})")

    def at(pos, end, rule, quote, fix):
        return _problem(rel, text, pos, rule, quote if quote is not None else _quote_at(text, pos, end), fix)

    for name, pattern in BANNED_APIS:
        m = pattern.search(text)
        if m:
            problems.append(at(m.start(), m.end(), f"uses {name}", None, "a custom component may not use it"))
    code, uncommented, org = _scan_js(text, origins=True)

    def raw(i):
        return org[i] if i < len(org) else len(text)

    if found == [factory]:
        top = _top_level(code)
        if top is None:
            problems.append(f"{rel}: brackets do not balance, so code could run as top-level code outside {factory}")
        elif not re.fullmatch(r"\s*function\s+" + re.escape(factory) + r"\s*\(\)\s*\{\}[\s;]*", top):
            problems.append(f"{rel}: top-level code other than function {factory}; keep every statement inside it")
    # Raw text too: a regex literal after ) or } reads as division to the scanner, which can hide code behind a fake comment.
    first = {}
    for m in BANNED_IDENTIFIER_RE.finditer(text):
        first.setdefault(m.group(1), (m.start(), m.end()))
    for rx in (BANNED_IDENTIFIER_RE, BANNED_GLOBAL_RE):
        for m in rx.finditer(uncommented):
            first.setdefault(m.group(1), (raw(m.start()), raw(m.end() - 1) + 1))
    for name in sorted(first):
        if not any(f"uses {name}" in p for p in problems):
            problems.append(at(*first[name], f"names {name}, which a custom component may not use", None, "remove it or use the plain property"))
    stores = {}
    for m in STORE_USE_RE.finditer(uncommented):
        if m.group(1) not in ("get", "list"):
            stores.setdefault(m.group(1), (raw(m.start()), raw(m.end() - 1) + 1))
    for name in sorted(stores):
        problems.append(at(*stores[name], f"ctx.store.{name}", None,
                           "a component reads with ctx.store.get and ctx.store.list, and writes only through ctx.actions"))
    spots = {m.start(): (m.start(), m.end()) for m in COMPUTED_ACCESS_RE.finditer(text)}
    for m in COMPUTED_ACCESS_RE.finditer(uncommented):
        spots.setdefault(raw(m.start()), (raw(m.start()), raw(m.end() - 1) + 1))
    for pos in sorted(spots)[:MAX_PER_RULE]:
        problems.append(at(*spots[pos], "computed member access", None,
                           "name the property directly, or use a numeric or plain string literal"))
    ons = [(m.start(), m.end()) for m in ON_KEY_RE.finditer(text)]
    for start, end in ons[:MAX_PER_RULE]:
        problems.append(at(start, end, "on* key", None,
                           "no event handlers in a custom component; use the click hooks the slot provides, "
                           "or reword; comments are scanned too"))
    lits = [(m.group(0)[1:-1], m.start()) for m in STRING_RE.finditer(text)]

    def first_of(pairs):
        out = {}
        for key, pos in pairs:
            out.setdefault(key, pos)
        return out

    for word, pos in sorted(first_of((m.group(1).lower(), pos) for lit, pos in lits for m in [RISKY_WORD_RE.match(lit)] if m).items()):
        problems.append(at(pos, pos, f"the literal {word}", text[pos:].split("\n", 1)[0],
                           "names a tag or attribute a custom component may not create"))
    for lit, pos in sorted(first_of((lit, pos) for lit, pos in lits if URL_LITERAL_RE.search(lit)).items()):
        problems.append(at(pos, pos, "string URL", lit, "URLs come from props through ui.urlOrText"))
    for lit, pos in sorted(first_of((lit, pos) for lit, pos in lits if lit in names).items() if names_apply else []):
        problems.append(at(pos, pos, f"the literal names this routine's {names[lit]}", f'{lit}',
                           "take it from props so the component stays reusable"))
    if parse:
        problems += _parse_problems(text, rel)
    return problems


def _lint_raw(comp_dir, folder, parse):
    """Source checks for a raw page: one source file, the size cap, the compile problems (imports, default export,
    markers, JSX) and, when node exists, node --check on the compiled thunk body. The banned-API text lint and the ctx
    checks are for factory components and do not apply: the page is the owner's reviewed code."""
    path = raw_source(comp_dir)
    if not path:
        if all(os.path.isfile(os.path.join(comp_dir, folder + ext)) for ext in (".jsx", ".js")):
            return [f"{folder}: a raw page has both {folder}.jsx and {folder}.js; keep one"]
        return [f"{folder}: a raw page needs {folder}.jsx or {folder}.js"]
    rel = f"{folder}/{os.path.basename(path)}"
    if os.path.getsize(path) > MAX_COMPONENT_BYTES:
        return [f"{rel}: larger than {MAX_COMPONENT_BYTES // 1024} KiB; split it or use a spec page (desk.pages)"]
    try:
        desk_libs.load_libraries()  # the hash reads the pinned versions; an unreadable registry must not reach approval
        compiled = desk_raw.compile_page(comp_dir)
    except desk_libs.LibraryError as exc:
        return [f"{rel}: {exc}"]
    if compiled.problems:
        return compiled.problems
    return _parse_problems(compiled.js, rel) if parse else []


def lint_component(comp_dir, definition=None, parse=True):
    """Problems with one custom component folder; `definition` is the routine's definition dict, when it has one.
    With `parse`, the component must also pass node --check (skipped with a note when node is not on PATH)."""
    folder = os.path.basename(os.path.normpath(comp_dir))
    m = _manifest(comp_dir)
    if m is None:
        return [f"component '{folder}': component.json is missing or not a JSON object"]
    problems = _check_custom_manifest(m, folder)
    cid = m.get("id") if isinstance(m.get("id"), str) else folder
    if is_raw(m):
        return problems + _lint_raw(comp_dir, folder, parse)
    rel = f"{folder}/{folder}.js"
    try:
        text = _read(os.path.join(comp_dir, folder + ".js"))
    except OSError:
        return problems + [f"{rel}: missing"]
    slot = m.get("slot", "field-cell")
    if len(text.encode("utf-8")) > MAX_COMPONENT_BYTES:
        problems.append(f"{rel}: larger than {MAX_COMPONENT_BYTES // 1024} KiB; split it or use a spec page (desk.pages)")
    problems += _check_custom_js(text, rel, factory_name(cid), routine_names(definition), parse, slot == "field-cell")
    if slot in INTERACTIVE_SLOTS:
        problems += _check_ctx_use(text, rel, factory_name(cid), m.get("verbs") if isinstance(m.get("verbs"), list) else [],
                                   m.get("prefs") is True)
    return problems


def component_warnings(comp_dir, definition=None):
    """Warnings for one component folder: findings that never fail a lint or change an exit code. Empty for now."""
    return []


def lint_routine_warnings(root, routine):
    """Warnings for a routine's custom components, as warning strings the callers print as WARN; a producer must name its own component."""
    defn = _routine_definition(routine)
    out = []
    for c in custom_components(routine):
        out += component_warnings(c["path"], defn)
    return out


def _routine_definition(routine):
    try:
        return definition.load(os.path.join(routine, "definition.json"))
    except (definition.DefinitionError, OSError, ValueError):
        return None


def lint_routine(reg, routine):
    """A routine's custom components, their ids against the core registry, and its modules' fields maps."""
    defn = _routine_definition(routine)
    core = {c.get("id") for c in reg.get("components", []) if isinstance(c, dict)}
    problems = []
    have = set()
    for d in _component_dirs(routine):
        folder = os.path.basename(d)
        have.add(folder)
        if folder in core:
            problems.append(f"component '{folder}': the id is taken by a core component; choose another id")
        problems += lint_component(d, defn)
        m = _manifest(d) or {}
        if m.get("slot") == "page" and not pages_enabled(routine):
            problems.append(f"component '{folder}': a page needs [desk] pages = true in routine.toml")
    tops = {}
    for d in _component_dirs(routine):
        m = _manifest(d) or {}
        if m.get("slot") == "record-section" and m.get("placement") == "top" and isinstance(m.get("types"), list):
            for t in m["types"]:
                tops.setdefault(t, []).append(os.path.basename(d))
    for t, ids in sorted(tops.items()):
        if len(ids) > 1:
            problems.append(f"record type '{t}': only one section may use placement top, found {', '.join(sorted(ids))}")
    desk = defn.get("desk") if isinstance(defn, dict) and isinstance(defn.get("desk"), dict) else {}
    for mod in desk.get("modules") or [] if isinstance(desk.get("modules"), list) else []:
        fields = mod.get("fields") if isinstance(mod, dict) and isinstance(mod.get("fields"), dict) else {}
        for field, cid in fields.items():
            if isinstance(cid, str) and cid not in have:
                problems.append(f"desk module '{mod.get('id')}' field '{field}': no custom component '{cid}' "
                                f"in desk/components/")
    start = desk.get("start")
    if isinstance(start, str) and start.startswith("x/"):
        pages = sorted(os.path.basename(d) for d in _component_dirs(routine) if (_manifest(d) or {}).get("slot") == "page")
        if start[2:] not in pages:
            problems.append(f"desk.start '{start}': no page component '{start[2:]}' in desk/components/ "
                            f"(page components: {', '.join(pages) or 'none'})")
    return problems
