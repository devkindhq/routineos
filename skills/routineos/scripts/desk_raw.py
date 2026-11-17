"""The raw page compiler (stdlib only; spec 5.3).

A raw page is one ESM module, <id>.jsx (or <id>.js written with createElement), that imports from the library
registry and default-exports a React component. compile_page turns it into the body of a thunk the Desk calls with
DESK_LIB: imports become const destructures from DESK_LIB, the default export becomes a plain declaration, JSX goes
through the vendored sucrase transformer (run with node), and the body ends with `return <Name>;`. Line numbers are
kept through every step so problems name the source line.
"""
import json
import os
import re
import shutil
import subprocess
from difflib import get_close_matches
from typing import NamedTuple

import desk_libs

HERE = os.path.dirname(os.path.abspath(__file__))
TRANSFORMER_ID = "sucrase-3.35.1-jsx-classic"
TRANSFORMER = os.path.join(HERE, "vendor", "jsx_transform.cjs")
# sha256 of vendor/jsx_transform.cjs for each TRANSFORMER_ID. tests/test_desk_raw_compile.py fails when the file no longer
# matches, so rebuilding the transformer means bumping TRANSFORMER_ID (which re-asks approval) and recording the new sha.
TRANSFORMER_SHA256 = {"sucrase-3.35.1-jsx-classic": "241f73251c293582abab112e7cfd552f4f8f29e3e08791b464f6f33caaae8913"}
RESERVED = ("__h", "__F")  # names the PROLOGUE declares
RESERVED_RE = re.compile(r"(?<![\w$])(__h|__F)(?![\w$])")
PROLOGUE = "const __h = DESK_LIB.react.createElement, __F = DESK_LIB.react.Fragment;"
DEFAULT_NAME = "__Page"
# bundle_desk.inject refuses these in any inline script, case-insensitive.
MARKERS = ("</script", "<script", "<!--")
TRANSFORM_TIMEOUT = 60

IDENT = r"[A-Za-z_$][\w$]*"
COMMENT = re.compile(r"/\*.*?\*/|//[^\n]*", re.S)
IMPORT_KW = re.compile(r"import(?![\w$])")
# The clause alternatives are disjoint (a comment cannot also match as plain characters, and a comment cannot end
# early), so a head that does not match fails in linear time instead of backtracking exponentially.
IMPORT_STMT = re.compile(r"import(?P<clause>(?:/\*(?:[^*]|\*(?!/))*\*/|//[^\n]*(?![^\n])|[^;'\"`/]|/(?![*/]))*?)"
                         r"\bfrom\s*(?P<q>['\"])(?P<spec>[^'\"\n]*)(?P=q)[ \t]*;?")
NAMED_ITEM = re.compile(r"(?P<name>%s)(?:\s+as\s+(?P<alias>%s))?" % (IDENT, IDENT))
DYNAMIC_IMPORT = re.compile(r"\bimport\s*\(")
LATE_IMPORT = re.compile(r"^\s*import\b")
EXPORT = re.compile(r"^\s*export\b")
EXPORT_DEFAULT = re.compile(r"^\s*export\s+default\b")
DEFAULT_FUNCTION = re.compile(r"^(?P<ind>\s*)export\s+default\s+function\b\s*(?P<name>%s)?\s*\(" % IDENT)
DEFAULT_NAME_STMT = re.compile(r"^\s*export\s+default\s+(?P<name>%s)\s*;?\s*(//.*)?$" % IDENT)
KEYWORDS = {"function", "class", "async", "await", "new", "null", "true", "false", "this", "void", "typeof"}
DEFAULT_HELP = "use export default function Name(...), export default function (...) or export default Name;"


class Imports(NamedTuple):
    body: str
    specifiers: list
    problems: list
    page: str = ""  # the local name the thunk returns (empty when there is no usable default export)


class Compiled(NamedTuple):
    js: object  # str, or None when there are problems
    specifiers: list
    problems: list


def _line(source, index):
    return source.count("\n", 0, index) + 1


def _skip_trivia(source, i):
    """Skip whitespace and comments from i; return the index of the next token."""
    n = len(source)
    while i < n:
        if source[i].isspace():
            i += 1
        elif source.startswith("//", i):
            end = source.find("\n", i)
            i = n if end < 0 else end
        elif source.startswith("/*", i):
            end = source.find("*/", i + 2)
            i = n if end < 0 else end + 2
        else:
            break
    return i


def _import_const(clause, spec, exports, where):
    """Return (const statement or None, problems) for one import clause from spec."""
    lib = "DESK_LIB[%s]" % json.dumps(spec)
    names = exports[spec]
    clause = " ".join(COMMENT.sub(" ", clause).split())
    named = re.fullmatch(r"\{(.*)\}", clause, re.S)
    if named:
        parts, problems = [], []
        for item in [x.strip() for x in named.group(1).split(",")]:
            if not item:
                continue
            m = NAMED_ITEM.fullmatch(item)
            if not m or (m.group("name") == "default" and not m.group("alias")):
                problems.append("%s: cannot read the imported name %r" % (where, item))
                continue
            name, alias = m.group("name"), m.group("alias")
            if name not in names:
                near = get_close_matches(name, names, n=3)
                hint = "; did you mean %s?" % ", ".join(near) if near else ""
                what = "the curated icon subset" if spec == "@tabler/icons-react" else "the exports of %s" % spec
                problems.append("%s: %s is not in %s%s" % (where, name, what, hint))
                continue
            parts.append("%s: %s" % (name, alias) if alias and alias != name else name)
        if problems:
            return None, problems
        return "const { %s } = %s;" % (", ".join(parts), lib), []
    m = re.fullmatch(r"\*\s*as\s+(%s)" % IDENT, clause)
    if m:
        return "const %s = %s;" % (m.group(1), lib), []
    if re.fullmatch(IDENT, clause) and clause not in KEYWORDS:
        if "default" not in names:
            return None, ["%s: %s has no default export; import names with { ... } or use import * as" % (where, spec)]
        return "const %s = %s.default;" % (clause, lib), []
    if re.match(r"%s\s*," % IDENT, clause):
        return None, ["%s: one form per import statement; split %r into a default import and a separate import"
                      % (where, "import " + clause)]
    return None, ["%s: unsupported import form %r" % (where, "import " + clause)]


def rewrite_module(source, rel, exports):
    """Rewrite the import head and the default export of a page module. Line count is preserved."""
    problems, specifiers, out = [], set(), []
    if source.startswith("﻿"):
        source = source[1:]
    i = 0
    while True:
        start = _skip_trivia(source, i)
        out.append(source[i:start])
        i = start
        if not IMPORT_KW.match(source, i) or source[_skip_trivia(source, i + 6):].startswith("("):
            break
        where = "%s:%d" % (rel, _line(source, i))
        m = IMPORT_STMT.match(source, i)
        if not m:
            end = source.find("\n", i)
            end = len(source) if end < 0 else end
            problems.append("%s: unsupported import form; use import { A } from \"pkg\", import X from \"pkg\" or "
                            "import * as M from \"pkg\"" % where)
            out.append("\n" * source.count("\n", i, end))
            i = end
            continue
        spec = m.group("spec")
        newlines = "\n" * m.group(0).count("\n")
        if spec.startswith((".", "/")):
            problems.append("%s: relative import %r is not allowed; a raw page is one file" % (where, spec))
            stmt = None
        elif spec not in exports:
            problems.append("%s: %r is not an allowed library (allowed: %s)" % (where, spec, ", ".join(sorted(exports))))
            stmt = None
        else:
            stmt, found = _import_const(m.group("clause"), spec, exports, where)
            problems.extend(found)
            if stmt:
                specifiers.add(spec)
        out.append((stmt or "") + newlines)
        i = m.end()

    first = _line(source, i)
    page = ""
    lines = source[i:].split("\n")
    for k, text in enumerate(lines):
        where = "%s:%d" % (rel, first + k)
        if DYNAMIC_IMPORT.search(text):
            problems.append("%s: dynamic import( is not allowed" % where)
        elif LATE_IMPORT.match(text):
            problems.append("%s: imports must come before any other statement" % where)
        if EXPORT_DEFAULT.match(text):
            if page:
                problems.append("%s: a second export default; a page has exactly one" % where)
                continue
            fn = DEFAULT_FUNCTION.match(text)
            nm = DEFAULT_NAME_STMT.match(text)
            if fn:
                page = fn.group("name") or DEFAULT_NAME
                lines[k] = "%sfunction %s(%s" % (fn.group("ind"), page, text[fn.end():])
            elif nm and nm.group("name") not in KEYWORDS:
                page = nm.group("name")
                lines[k] = ""
            else:
                problems.append("%s: unsupported export default form; %s" % (where, DEFAULT_HELP))
                page = page or "?"
        elif EXPORT.match(text):
            problems.append("%s: only the one export default is allowed in a page" % where)
    if not page:
        problems.append("%s:%d: the page has no export default; %s" % (rel, source.count("\n") + 1, DEFAULT_HELP))
    for n, text in enumerate(source.split("\n"), 1):
        low = text.lower()
        for marker in MARKERS:
            if marker in low:
                problems.append("%s:%d: %s is not allowed in a page (the Desk inlines it in a script tag)"
                                % (rel, n, marker))
    body = "".join(out) + "\n".join(lines)
    return Imports(body, sorted(specifiers), problems, "" if page == "?" else page)


def transform_jsx(code, rel):
    """Compile JSX with the vendored sucrase transformer. Returns (code, []) or (None, problems)."""
    node = shutil.which("node")
    if not node:
        cid = os.path.splitext(os.path.basename(rel))[0]
        return None, ["%s: node is not on PATH, so JSX cannot be compiled. Install a current Node.js LTS, or write the "
                      "page as %s.js with React.createElement (see references/desk-raw-pages.md)" % (rel, cid)]
    try:
        run = subprocess.run([node, TRANSFORMER], input=code, capture_output=True, text=True, encoding="utf-8",
                             timeout=TRANSFORM_TIMEOUT)
        try:
            data = json.loads(run.stdout)
        except ValueError as exc:
            err = [ln for ln in run.stderr.strip().splitlines() if ln.strip()]
            return None, ["%s: the JSX transformer failed: %s (node exit code %s%s)"
                          % (rel, exc, run.returncode, ", stderr: " + err[-1].strip() if err else "")]
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, ["%s: the JSX transformer failed: %s" % (rel, exc)]
    if not isinstance(data, dict):
        return None, ["%s: the JSX transformer returned %r" % (rel, data)]
    if isinstance(data.get("code"), str):
        return data["code"], []
    line = data.get("line")
    where = "%s:%d" % (rel, line) if isinstance(line, int) else rel
    return None, ["%s: %s" % (where, data.get("error") or "the JSX transformer failed")]


def compile_page(comp_dir, exports=None):
    """Compile the raw page in comp_dir (<id>.jsx or <id>.js) to a thunk body ending in `return <Name>;`."""
    cid = os.path.basename(os.path.normpath(comp_dir))
    found = [name for name in (cid + ".jsx", cid + ".js") if os.path.isfile(os.path.join(comp_dir, name))]
    if len(found) != 1:
        what = "both %s.jsx and %s.js" % (cid, cid) if found else "neither %s.jsx nor %s.js" % (cid, cid)
        return Compiled(None, [], ["%s: a raw page needs exactly one source file, found %s" % (cid, what)])
    rel = found[0]
    try:
        with open(os.path.join(comp_dir, rel), encoding="utf-8-sig") as fh:
            source = fh.read()
    except (OSError, UnicodeDecodeError) as exc:
        return Compiled(None, [], ["%s: cannot read: %s" % (rel, exc)])
    if exports is None:
        exports = desk_libs.load_exports()
    imports = rewrite_module(source, rel, exports)
    if imports.problems:
        return Compiled(None, imports.specifiers, imports.problems)
    code = imports.body
    reserved = [n for n, text in enumerate(code.split("\n"), 1) if RESERVED_RE.search(text)]
    if reserved:
        return Compiled(None, imports.specifiers, [
            "%s:%d: %s are reserved for the page prologue; rename it" % (rel, n, " and ".join(RESERVED))
            for n in reserved])
    if rel.endswith(".jsx"):
        code, problems = transform_jsx(code, rel)
        if problems:
            return Compiled(None, imports.specifiers, problems)
    if not code.endswith("\n"):
        code += "\n"
    # The prologue shares line 1 so compiled line n is source line n.
    js = PROLOGUE + code + "return %s;\n" % imports.page
    problems = []
    for n, text in enumerate(js.split("\n"), 1):
        low = text.lower()
        for marker in MARKERS:
            if marker in low:
                problems.append("%s:%d: the compiled output contains %s (from an entity or escape); the Desk cannot "
                                "inline it" % (rel, n, marker))
    if problems:
        return Compiled(None, imports.specifiers, problems)
    return Compiled(js, imports.specifiers, [])
