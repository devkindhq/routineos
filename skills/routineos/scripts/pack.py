"""Routine packs: one JSON file that replicates a routine. Standard library only (Python 3.11+).

A pack is data. Nothing here runs pack code, and nothing fetches any URL but the one given.
"""
import hashlib
import http.client
import ipaddress
import json
import os
import re
import shutil
import socket
import tomllib
import urllib.error
import urllib.parse
import urllib.request

import appmodel
import definition
import desk_contract
import schema

FORMAT = "routineos.pack.v1"
CATALOG_FORMAT = "routineos.catalog.v1"
VERSION = "0.11.0"
USER_AGENT = f"routineos-pack/{VERSION}"
MAX_PACK_BYTES = 512 * 1024
MAX_INDEX_BYTES = 1024 * 1024
MAX_FILES, MAX_STAGES, MAX_CONNECTORS, MAX_INSPIRATION, MAX_ALTERNATIVES = 40, 20, 20, 10, 5
MAX_DEPTH = 32

# Top-level keys in the order packs are written (spec D1).
PACK_KEYS = ("$schema", "format", "id", "version", "title", "summary", "category", "maturity", "license",
             "inspiration", "routine", "prompt", "readme", "definition", "stages", "connectors", "files")
REQUIRED_KEYS = ("format", "id", "version", "title", "summary", "category", "maturity", "routine", "prompt",
                 "readme", "stages", "connectors")
BODY_KEYS = ("routine", "prompt", "readme", "definition", "files")
META_KEYS = tuple(k for k in PACK_KEYS if k not in BODY_KEYS)
CATEGORIES = ("sales", "marketing", "ops", "support", "finance", "recruiting", "content", "dev", "general")
MATURITY = ("piloted", "unpiloted")
STAGE_KINDS = ("code", "model", "skill", "gate")
CONNECTOR_KINDS = ("connector", "mcp", "builtin", "http")
ACCESS = ("read", "write")

ROUTINE_TABLES = {
    "routine": ("name", "type", "schedule", "first_run"),
    "store": ("adapter",),
    "workspace": ("enabled", "name", "template", "template_version"),
    "setting": ("name", "type", "label", "example", "role", "default", "min", "max", "choices", "cost_note"),
    "gate": ("enabled", "transport", "timeout_hours"),
    "action": ("name", "kind"),
}
ARRAY_TABLES = ("setting", "action")
DEFINITION_KEYS = ("version", "label", "inbox", "types", "views", "learning", "desk")
TYPE_KEYS = ("label", "plural", "icon", "identity", "merge", "fields", "links", "settingFilters")
FIELD_KEYS = ("label", "type", "summary", "choices")
FILTER_KEYS = ("setting", "field")
VIEW_KEYS = ("id", "type", "name", "icon", "filters", "sort", "columns", "window", "group")
STAGE_KEYS = ("id", "kind", "title", "does", "connectors", "reads", "writes", "command", "skill")
CONNECTOR_KEYS = ("id", "label", "kind", "purpose", "required", "access", "stages", "alternatives", "connect")
INSPIRATION_KEYS = ("source", "title", "url")
INDEX_KEYS = ("format", "templates")
ENTRY_KEYS = ("id", "version", "title", "summary", "category", "maturity", "type", "schedule", "path", "bytes",
              "sha256", "connectors", "inspiration")
ENTRY_CONNECTOR_KEYS = ("id", "label", "required")

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}\Z")
SEMVER_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")
COLLECTION_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*(/[a-z0-9_-]+)*\Z")
# Segments after the first allow upper case so skills/<name>/SKILL.md fits.
FILE_RE = re.compile(r"^(lib|skills)/[a-z0-9_-]+(/(?!\.\.?/)[A-Za-z0-9_.-]+)*\.(py|md|json|txt)\Z")
RESERVED_PARTS = ("con", "prn", "aux", "nul", "com1", "lpt1")
COMPONENT_CODE_MESSAGE = ("packs carry module JSON, not component code; copy the component with "
                          "`routineos desk component copy` or propose it for the core registry")
EMAIL_RE = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.-]+")
SLACK_ID_RE = re.compile(r"\b[UCDGW](?=[A-Z0-9]*[0-9])[A-Z0-9]{8,}\b")
RECIPIENT_WORDS = ("recipient", "approver", "email", "address", "cc", "bcc", "channel", "phone")
SHELL_CHARS = set(";|&$`<>(){}\\\"'*?!~")
CORE_SCRIPT = "skills/routineos/scripts/routineos.py"
FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.S)


class PackError(Exception):
    """A pack that cannot be read or used. `io` is true when the cause was reading, not the pack itself."""

    def __init__(self, problems, io=False):
        self.problems = [problems] if isinstance(problems, str) else list(problems)
        self.io = io
        super().__init__("; ".join(self.problems))


# Parsing


def _no_duplicates(pairs):
    out = {}
    for key, val in pairs:
        if key in out:
            raise PackError(_safe(appmodel.redact(f"duplicate key '{key}'")))
        out[key] = val
    return out


def _no_constants(name):
    raise PackError(f"{name} is not allowed in a pack")


def parse(raw, cap=MAX_PACK_BYTES, what="pack"):
    """The JSON object in raw bytes; refuses oversize, bad UTF-8, duplicate keys, NaN and non-objects."""
    if len(raw) > cap:
        raise PackError(f"{what} is over the {cap} byte limit")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise PackError(f"{what} is not UTF-8 text")
    try:
        obj = json.loads(text, object_pairs_hook=_no_duplicates, parse_constant=_no_constants)
    except json.JSONDecodeError as exc:
        raise PackError(f"{what} is not valid JSON (line {exc.lineno}, column {exc.colno})")
    except RecursionError:
        raise PackError(f"{what} is nested more than {MAX_DEPTH} levels deep")
    if not isinstance(obj, dict):
        raise PackError(f"{what} must be a JSON object")
    if _depth(obj) > MAX_DEPTH:
        raise PackError(f"{what} is nested more than {MAX_DEPTH} levels deep")
    return obj


def _depth(obj):
    """The nesting depth of parsed JSON, counted without recursion."""
    deepest, todo = 0, [(obj, 1)]
    while todo:
        node, level = todo.pop()
        if isinstance(node, (dict, list)):
            deepest = max(deepest, level)
            todo += [(x, level + 1) for x in (node.values() if isinstance(node, dict) else node)]
    return deepest


# Reading a source: a disk path, or one https URL with no redirects.

SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
FETCH_TIMEOUT = 20


class _RefuseRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "redirect refused", headers, fp)


class NotPublicAddress(OSError):
    pass


# IPv6 forms that carry an IPv4 address: NAT64, local NAT64, IPv4-compatible. 6to4 and Teredo are checked by property.
IPV4_CARRYING = tuple(ipaddress.ip_network(n) for n in ("64:ff9b::/96", "64:ff9b:1::/48", "::/96"))


def public_addresses(host, port):
    """getaddrinfo addresses for host; NotPublicAddress if any is loopback, private, link-local or reserved,
    or an IPv6 form that carries an IPv4 address."""
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if ip.version == 6 and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        if ip.version == 6 and (ip.sixtofour or ip.teredo or any(ip in n for n in IPV4_CARRYING)):
            raise NotPublicAddress("not a public address")
        if not ip.is_global or ip.is_multicast:
            raise NotPublicAddress("not a public address")
    return [info[4] for info in infos]


def _connect_public(address, timeout=socket._GLOBAL_DEFAULT_TIMEOUT, source_address=None):
    """socket.create_connection to a vetted IP, so a second DNS answer (a rebind) is never used."""
    err = None
    for sockaddr in public_addresses(*address):
        try:
            return socket.create_connection(sockaddr[:2], timeout, source_address)
        except OSError as exc:
            err = exc
    raise err or OSError("no address")


class _PublicHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        if not self._tunnel_host:
            self._create_connection = _connect_public
            return super().connect()
        # Through a proxy the person configured: CONNECT to the vetted IP so the proxy never resolves the
        # name, and keep the name for SNI and the certificate check.
        name, headers = self._tunnel_host, dict(self._tunnel_headers)
        ip = public_addresses(name, self._tunnel_port)[0][0]
        self._tunnel_host = ip
        self._tunnel_headers["Host"] = f"{'[' + ip + ']' if ':' in ip else ip}:{self._tunnel_port}"
        try:
            http.client.HTTPConnection.connect(self)
        finally:
            self._tunnel_host, self._tunnel_headers = name, headers
        self.sock = self._context.wrap_socket(self.sock, server_hostname=name)


class PublicHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_PublicHTTPSConnection, req, context=self._context)


def no_redirect_opener(proxies=None):
    """An opener that refuses redirects, keeps no cookies and connects only to public addresses.
    proxies=None uses the environment's."""
    return urllib.request.build_opener(urllib.request.ProxyHandler(proxies), _RefuseRedirect(), PublicHTTPSHandler())


def _shown(url):
    """The URL without user info or query, safe to print."""
    parts = urllib.parse.urlsplit(url)
    return f"{parts.scheme}://{parts.hostname or ''}{parts.path}"


def read_source(src, cap, opener=None):
    """At most `cap` bytes from a disk path or an https URL; raises PackError(io=True) on anything else."""
    if SCHEME_RE.match(src):
        if not src.startswith("https://"):
            raise PackError("only https:// URLs or local file paths are accepted", io=True)
        opener = opener or no_redirect_opener()
        req = urllib.request.Request(src, headers={"User-Agent": USER_AGENT})
        try:
            with opener.open(req, timeout=FETCH_TIMEOUT) as resp:
                raw = resp.read(cap + 1)
        except urllib.error.HTTPError as exc:
            reason = "redirect refused" if 300 <= exc.code < 400 else f"HTTP {exc.code}"
            raise PackError(f"cannot fetch {_shown(src)}: {reason}", io=True)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            if isinstance(exc, NotPublicAddress) or isinstance(getattr(exc, "reason", None), NotPublicAddress):
                raise PackError(f"cannot fetch {_shown(src)}: not a public address (loopback, private, link-local "
                                "or reserved)", io=True)
            raise PackError(f"cannot fetch {_shown(src)}: {type(exc).__name__}", io=True)
    else:
        try:
            with open(src, "rb") as fh:
                raw = fh.read(cap + 1)
        except OSError as exc:
            raise PackError(f"cannot read {src}: {exc.strerror or type(exc).__name__}", io=True)
    if len(raw) > cap:
        raise PackError(f"{_shown(src) if SCHEME_RE.match(src) else src} is over the {cap} byte limit", io=True)
    return raw


def load(src, opener=None):
    """A parsed (not yet validated) pack from a path or an https URL."""
    return parse(read_source(src, MAX_PACK_BYTES, opener=opener))


# Validation helpers


def _unknown(obj, allowed, where):
    return [f"{where}: unknown key '{k}'" for k in obj if k not in allowed]


def _text(obj, key, where, limit, required=True):
    v = obj.get(key)
    if v is None and not required:
        return []
    if not isinstance(v, str) or not v.strip():
        return [f"{where}.{key} must be non-empty text"]
    if len(v) > limit:
        return [f"{where}.{key} is over {limit} characters"]
    return []


def _str_list(obj, key, where, limit=None):
    v = obj.get(key, [])
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        return [f"{where}.{key} must be a list of text"], []
    if limit is not None and len(v) > limit:
        return [f"{where}.{key} has more than {limit} entries"], v
    return [], v


def _meta_problems(p):
    problems = [f"missing key '{k}'" for k in REQUIRED_KEYS if k not in p]
    problems += _unknown(p, PACK_KEYS, "pack")
    if "$schema" in p and not isinstance(p["$schema"], str):
        problems.append("$schema must be text")
    if "format" in p and p["format"] != FORMAT:
        problems.append(f"format must be {FORMAT}")
    if "id" in p and not (isinstance(p["id"], str) and ID_RE.match(p["id"])):
        problems.append("id must be lowercase letters, digits and hyphens, at most 64 characters")
    if "version" in p and not (isinstance(p["version"], str) and SEMVER_RE.match(p["version"])):
        problems.append("version must be MAJOR.MINOR.PATCH")
    if "title" in p:
        problems += _text(p, "title", "pack", 80)
    if "summary" in p:
        problems += _text(p, "summary", "pack", 280)
    if "category" in p and p["category"] not in CATEGORIES:
        problems.append(f"category must be one of {', '.join(CATEGORIES)}")
    if "maturity" in p and p["maturity"] not in MATURITY:
        problems.append(f"maturity must be one of {', '.join(MATURITY)}")
    if "license" in p:
        problems += _text(p, "license", "pack", 64)
    insp = p.get("inspiration", [])
    if not isinstance(insp, list) or len(insp) > MAX_INSPIRATION:
        problems.append(f"inspiration must be a list of at most {MAX_INSPIRATION} links")
        insp = []
    for i, link in enumerate(insp):
        where = f"inspiration[{i}]"
        if not isinstance(link, dict):
            problems.append(f"{where} must be an object")
            continue
        problems += _unknown(link, INSPIRATION_KEYS, where)
        for key in INSPIRATION_KEYS:
            problems += _text(link, key, where, 300)
        if isinstance(link.get("url"), str) and not link["url"].startswith("https://"):
            problems.append(f"{where}.url must be an https link")
    for key in ("prompt", "readme"):
        if key in p and not isinstance(p[key], str):
            problems.append(f"{key} must be text")
    return problems


def _routine_problems(p):
    r = p.get("routine")
    if not isinstance(r, dict):
        return ["routine must be an object of routine.toml tables"]
    problems = _unknown(r, ROUTINE_TABLES, "routine")
    for table, keys in ROUTINE_TABLES.items():
        if table not in r:
            continue
        rows = r[table] if table in ARRAY_TABLES else [r[table]]
        if table in ARRAY_TABLES and not isinstance(r[table], list):
            problems.append(f"routine.{table} must be a list of tables")
            continue
        for i, row in enumerate(rows):
            where = f"routine.{table}[{i}]" if table in ARRAY_TABLES else f"routine.{table}"
            if not isinstance(row, dict):
                problems.append(f"{where} must be a table")
                continue
            problems += _unknown(row, keys, where)
    head = r.get("routine")
    if not isinstance(head, dict):
        return problems + ["routine.routine: missing [routine] table"]
    for key in ("name", "type", "schedule"):
        if not isinstance(head.get(key), str) or not head[key].strip():
            problems.append(f"routine.routine.{key} is missing")
    if head.get("type") not in schema.ROUTINE_TYPES:
        problems.append(f"routine type must be one of {', '.join(schema.ROUTINE_TYPES)}")
    if head.get("name") != p.get("id"):
        problems.append("id must equal routine.name")
    ws = r.get("workspace")
    if isinstance(ws, dict):
        # The name reaches the Desk page's config block, so it is held to the routine-name pattern.
        for key in ("name", "template"):
            if key in ws and not (isinstance(ws[key], str) and ID_RE.match(ws[key])):
                problems.append(f"routine.workspace.{key} must be lowercase letters, digits and hyphens")
        tv = ws.get("template_version", 1)
        if isinstance(tv, bool) or not isinstance(tv, int) or tv < 1:
            problems.append("routine.workspace.template_version must be a whole number of 1 or more")
    if head.get("first_run", "report-only") != "report-only":
        problems.append("routine.first_run must be report-only in a pack; a person switches a routine live")
    for table in ("store", "workspace", "gate"):
        if table in r and not isinstance(r[table], dict):
            return problems
    if not all(isinstance(s, dict) for s in r.get("setting", []) if isinstance(r.get("setting"), list)):
        return problems
    prompt = p.get("prompt") if isinstance(p.get("prompt"), str) else None
    problems += [f"routine: {x}" for x in schema.lint(r, prompt)]
    for s in r.get("setting", []) if isinstance(r.get("setting"), list) else []:
        name = s.get("name")
        words = re.split(r"[^a-z0-9]+", str(name).casefold())
        if any(w in RECIPIENT_WORDS or w.rstrip("s") in RECIPIENT_WORDS for w in words):
            if s.get("default") != []:
                problems.append(f"setting '{name}': names who to contact, so its default must be an empty list")
    return problems


def _workspace_on(p):
    ws = p.get("routine", {}).get("workspace") if isinstance(p.get("routine"), dict) else None
    return isinstance(ws, dict) and ws.get("enabled") is True


def _definition_problems(p):
    on = _workspace_on(p)
    if "definition" not in p:
        return ["definition is missing; a routine with workspace.enabled needs one"] if on else []
    if not on:
        return ["definition is only allowed when routine.workspace.enabled is true"]
    d = p["definition"]
    if not isinstance(d, dict):
        return ["definition must be an object"]
    problems = _unknown(d, DEFINITION_KEYS, "definition")
    types = d.get("types") if isinstance(d.get("types"), dict) else {}
    for tname, tdef in types.items():
        where = f"definition.types.{tname}"
        if not isinstance(tdef, dict):
            continue
        problems += _unknown(tdef, TYPE_KEYS, where)
        for fname, fdef in (tdef.get("fields") or {}).items() if isinstance(tdef.get("fields"), dict) else ():
            if isinstance(fdef, dict):
                problems += _unknown(fdef, FIELD_KEYS, f"{where}.fields.{fname}")
        for i, flt in enumerate(tdef.get("settingFilters", []) if isinstance(tdef.get("settingFilters"), list) else []):
            if isinstance(flt, dict):
                problems += _unknown(flt, FILTER_KEYS, f"{where}.settingFilters[{i}]")
            else:
                problems.append(f"{where}.settingFilters[{i}] must be an object")
    views = d.get("views", [])
    for i, view in enumerate(views if isinstance(views, list) else []):
        if isinstance(view, dict):
            problems += _unknown(view, VIEW_KEYS, f"definition.views[{i}]")
    if problems:
        return problems
    r = p["routine"]
    producer = {"id": r["routine"].get("name"), "label": r["routine"].get("name"),
                "schedule": r["routine"].get("schedule", ""), "definition": d,
                "settings": r.get("setting", []) if isinstance(r.get("setting"), list) else []}
    try:
        definition.compile([producer])
    except definition.DefinitionError as exc:
        return [f"definition: {x}" for x in exc.problems]
    except (AttributeError, TypeError) as exc:
        return [f"definition: malformed ({type(exc).__name__})"]
    return []


def _people(name):
    return any(name == pre.rstrip("/") or name.startswith(pre) for pre in desk_contract.HUMAN_PREFIXES)


def _skill_problems(where, name, files):
    path = f"skills/{name}/SKILL.md"
    text = files.get(path)
    if not isinstance(text, str):
        return [f"{where}: skill '{name}' needs {path} in files"]
    m = FRONTMATTER_RE.match(text)
    fm = {}
    if m:
        fm = dict((k.strip(), v.strip()) for k, v in (ln.split(":", 1) for ln in m.group(1).splitlines() if ":" in ln))
    if fm.get("name") != name:
        return [f"{where}: {path} frontmatter name must be '{name}'"]
    return []


def _command_problems(where, cmd, files):
    if not isinstance(cmd, str) or not cmd.strip():
        return [f"{where}: a code stage needs a command"]
    if "\n" in cmd or "\r" in cmd or any(c in SHELL_CHARS for c in cmd):
        return [f"{where}: command must be a single plain line with no shell operators"]
    parts = cmd.split()
    if parts[0] != "python3":
        return [f"{where}: command must start with python3"]
    # The script comes straight after python3: an option such as -m or -c would run something else.
    script = parts[1] if len(parts) > 1 else None
    if script == CORE_SCRIPT:
        return []
    if script and script.startswith("lib/") and script.endswith(".py"):
        return [] if script in files else [f"{where}: command names {script}, which is not in files"]
    return [f"{where}: command must name {CORE_SCRIPT} or a lib/*.py file the pack ships"]


def _stage_connector_problems(p):
    problems = []
    stages, connectors = p.get("stages"), p.get("connectors")
    files = p.get("files") if isinstance(p.get("files"), dict) else {}
    gated = _gated(p)
    if not isinstance(stages, list) or not 1 <= len(stages) <= MAX_STAGES:
        problems.append(f"stages must be a list of 1 to {MAX_STAGES} stages")
        stages = stages if isinstance(stages, list) else []
    if not isinstance(connectors, list) or len(connectors) > MAX_CONNECTORS:
        problems.append(f"connectors must be a list of at most {MAX_CONNECTORS}")
        connectors = connectors if isinstance(connectors, list) else []
    by_stage, by_conn = {}, {}
    for i, s in enumerate(stages):
        where = f"stages[{i}]"
        if not isinstance(s, dict):
            problems.append(f"{where} must be an object")
            continue
        problems += _unknown(s, STAGE_KEYS, where)
        sid = s.get("id")
        if not isinstance(sid, str) or not ID_RE.match(sid):
            problems.append(f"{where}.id must be lowercase letters, digits and hyphens")
        elif sid in by_stage:
            problems.append(f"{where}: duplicate stage id '{sid}'")
        else:
            by_stage[sid] = s
        kind = s.get("kind")
        if kind not in STAGE_KINDS:
            problems.append(f"{where}.kind must be one of {', '.join(STAGE_KINDS)}")
        problems += _text(s, "title", where, 80) + _text(s, "does", where, 500)
        for key in ("connectors", "reads", "writes"):
            bad, items = _str_list(s, key, where, 20)
            problems += bad
            if key != "connectors":
                for name in items:
                    if not COLLECTION_RE.match(name):
                        problems.append(f"{where}.{key}: '{name}' is not a store collection name")
                    elif _people(name):
                        problems.append(f"{where}.{key}: '{name}' is a people collection; only people write it")
        if kind == "code":
            problems += _command_problems(where, s.get("command"), files)
        elif "command" in s:
            problems.append(f"{where}: only a code stage has a command")
        if kind == "skill":
            name = s.get("skill")
            if not isinstance(name, str) or not ID_RE.match(name):
                problems.append(f"{where}: a skill stage needs a skill name")
            else:
                problems += _skill_problems(where, name, files)
        elif "skill" in s:
            problems.append(f"{where}: only a skill stage names a skill")
        if kind == "gate" and not gated:
            problems.append(f"{where}: a gate stage needs routine.gate.enabled = true")
    for i, c in enumerate(connectors):
        where = f"connectors[{i}]"
        if not isinstance(c, dict):
            problems.append(f"{where} must be an object")
            continue
        problems += _unknown(c, CONNECTOR_KEYS, where)
        cid = c.get("id")
        if not isinstance(cid, str) or not ID_RE.match(cid):
            problems.append(f"{where}.id must be lowercase letters, digits and hyphens")
        elif cid in by_conn:
            problems.append(f"{where}: duplicate connector id '{cid}'")
        else:
            by_conn[cid] = c
        problems += _text(c, "label", where, 80) + _text(c, "purpose", where, 300) + _text(c, "connect", where, 600)
        if c.get("kind") not in CONNECTOR_KINDS:
            problems.append(f"{where}.kind must be one of {', '.join(CONNECTOR_KINDS)}")
        if not isinstance(c.get("required"), bool):
            problems.append(f"{where}.required must be true or false")
        if c.get("access") not in ACCESS:
            problems.append(f"{where}.access must be read or write")
        elif c["access"] == "write" and not gated:
            problems.append(f"{where}: a write connector needs routine.gate.enabled = true")
        bad, alts = _str_list(c, "alternatives", where, MAX_ALTERNATIVES)
        problems += bad
        if any(not x.strip() or len(x) > 80 for x in alts):
            problems.append(f"{where}.alternatives: each must be non-empty text of at most 80 characters")
        if "stages" not in c:
            problems.append(f"{where}.stages is missing; use [] for a connector no stage uses")
        bad, used = _str_list(c, "stages", where, MAX_STAGES)
        problems += bad
        if c.get("required") is True and not used:
            problems.append(f"{where}: required, but no stage uses it")
    for sid, s in by_stage.items():
        for cid in s.get("connectors", []) if isinstance(s.get("connectors"), list) else []:
            c = by_conn.get(cid)
            if c is None:
                problems.append(f"stage '{sid}': undeclared connector '{cid}'")
            elif sid not in (c.get("stages") or []):
                problems.append(f"connector '{cid}' does not list stage '{sid}' that uses it")
    for cid, c in by_conn.items():
        for sid in c.get("stages", []) if isinstance(c.get("stages"), list) else []:
            s = by_stage.get(sid)
            if s is None:
                problems.append(f"connector '{cid}': unknown stage '{sid}'")
            elif cid not in (s.get("connectors") or []):
                problems.append(f"stage '{sid}' does not list connector '{cid}' that names it")
    return problems


def _gated(p):
    r = p.get("routine") if isinstance(p.get("routine"), dict) else {}
    gate = r.get("gate")
    return isinstance(gate, dict) and gate.get("enabled") is True


def _file_problems(p):
    if "files" not in p:
        return []
    files = p["files"]
    if not isinstance(files, dict):
        return ["files must be an object of path: text"]
    problems = []
    if len(files) > MAX_FILES:
        problems.append(f"files: more than {MAX_FILES} files")
    folded = set()
    for i, (path, text) in enumerate(files.items()):
        parts = path.split("/")
        stems = [x.split(".")[0].casefold() for x in parts]
        if path.startswith("desk/components/") or path.endswith(".js"):
            problems.append(f"files[{i}]: {COMPONENT_CODE_MESSAGE}")
        elif not FILE_RE.match(path) or ".." in parts or "." in parts or any(s in RESERVED_PARTS for s in stems):
            problems.append(f"files[{i}]: path is not allowed; use lib/ or skills/ with a .py, .md, .json or .txt name")
        # On a case-insensitive disk the later file would overwrite the earlier one.
        if path.casefold() in folded:
            problems.append(f"files[{i}]: path differs from another only by letter case")
        folded.add(path.casefold())
        if not isinstance(text, str) or "\x00" in text:
            problems.append(f"files[{i}]: content must be text")
    return problems


# C0 and C1 control characters, and DEL, other than a newline. They could rewrite a terminal or a page.
CONTROL_RE = re.compile(r"[\x00-\x09\x0b-\x1f\x7f-\x9f]")
# JSON can spell a lone surrogate; it cannot be written to a UTF-8 file.
SURROGATE_RE = re.compile("[\ud800-\udfff]")


def _safe(text):
    """A message with any control character shown as '?', so problems never carry them to a terminal."""
    return CONTROL_RE.sub("?", text)


def _scan(node, path, out):
    if isinstance(node, str):
        if CONTROL_RE.search(node):
            out.append(f"{path}: contains a control character; only plain text and newlines are allowed")
        if SURROGATE_RE.search(node):
            out.append(f"{path}: contains an unpaired surrogate; text must be valid Unicode")
        if any(pat.search(node) for pat in appmodel.SECRET_PATTERNS):
            out.append(f"{path}: looks like a secret value, remove it")
        if EMAIL_RE.search(node):
            out.append(f"{path}: contains an email address; people add addresses on the Desk")
        if SLACK_ID_RE.search(node):
            out.append(f"{path}: contains a Slack-style member or channel id")
    elif isinstance(node, dict):
        for i, (key, val) in enumerate(node.items()):
            if CONTROL_RE.search(key):
                out.append(f"{path or 'pack'}: key {i} contains a control character")
                sub = f"{path}[key {i}]"
            elif path == "files":
                sub = f"files[{i}]"
            else:
                sub = f"{path}.{key}" if path else str(key)
            _scan(val, sub, out)
    elif isinstance(node, list):
        for i, val in enumerate(node):
            _scan(val, f"{path}[{i}]", out)


def validate(p):
    """Every problem with a parsed pack, in the order of spec D6. Messages never echo scanned values."""
    if not isinstance(p, dict):
        return ["pack must be a JSON object"]
    if _depth(p) > MAX_DEPTH:
        return [f"pack is nested more than {MAX_DEPTH} levels deep"]
    problems = _meta_problems(p)
    problems += _routine_problems(p)
    problems += _definition_problems(p)
    problems += _stage_connector_problems(p)
    problems += _file_problems(p)
    scanned = []
    _scan(p, "", scanned)
    problems += scanned
    return [_safe(appmodel.redact(x)) for x in problems]


# TOML emitter for the shapes allowed in ROUTINE_TABLES.

BARE_KEY_RE = re.compile(r"^[A-Za-z0-9_-]+\Z")


def _toml_key(k):
    return k if BARE_KEY_RE.match(k) else json.dumps(k)


def _toml_value(v, where):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if v != v or v in (float("inf"), float("-inf")):
            raise PackError(f"{where}: numbers must be finite")
        return repr(v)
    if isinstance(v, str):
        # Not ensure_ascii: TOML has no surrogate escapes. DEL is the one control json leaves bare.
        return json.dumps(v, ensure_ascii=False).replace("\x7f", "\\u007f")
    if isinstance(v, list):
        return "[" + ", ".join(_toml_value(x, where) for x in v) + "]"
    raise PackError(f"{where}: only text, numbers, true or false and lists can be written to routine.toml")


def toml_dumps(routine):
    """routine.toml text for a dict of tables and arrays of tables. Comments are not kept."""
    blocks = []
    for table, body in routine.items():
        rows, header = ([body], f"[{_toml_key(table)}]") if isinstance(body, dict) else (body, f"[[{_toml_key(table)}]]")
        if not isinstance(rows, list) or not all(isinstance(x, dict) for x in rows):
            raise PackError(f"routine.{table} must be a table or a list of tables")
        for row in rows:
            lines = [header]
            for k, v in row.items():
                if isinstance(v, dict):
                    raise PackError(f"routine.{table}.{k}: nested tables are not allowed")
                lines.append(f"{_toml_key(k)} = {_toml_value(v, f'routine.{table}.{k}')}")
            blocks.append("\n".join(lines))
    return "\n\n".join(blocks) + "\n"


def dumps(p):
    """Pack JSON text: top-level keys in PACK_KEYS order, files sorted by path, indent 2, trailing newline."""
    ordered = {k: p[k] for k in PACK_KEYS if k in p}
    ordered.update({k: v for k, v in p.items() if k not in ordered})
    if isinstance(ordered.get("files"), dict):
        ordered["files"] = dict(sorted(ordered["files"].items()))
    return json.dumps(ordered, indent=2, ensure_ascii=False) + "\n"


# Install


def renamed(p, name):
    """A copy of the pack under a new routine name; workspace.template keeps the source id."""
    out = json.loads(json.dumps(p))
    source = p["id"]
    out["id"] = name
    out["routine"]["routine"]["name"] = name
    ws = out["routine"].get("workspace")
    if isinstance(ws, dict) and ws.get("enabled") is True:
        ws.setdefault("template", source)
    return out


def folder_files(p, desk_html):
    """{relative path: text} for a routine folder made from a valid pack."""
    out = {"routine.toml": toml_dumps(p["routine"]), "prompt.md": p["prompt"], "README.md": p["readme"]}
    if "definition" in p:
        out["definition.json"] = json.dumps(p["definition"], indent=2, ensure_ascii=False) + "\n"
        ws = p["routine"].get("workspace", {})
        out["dashboard/index.html"] = desk_html(ws.get("name") or p["routine"]["routine"]["name"])
    out.update(p.get("files", {}))
    out["pack.json"] = dumps({k: p[k] for k in META_KEYS if k in p})
    return out


def install(p, target, desk_html):
    """Write a valid pack into `target`, which must not exist. Writes a temporary sibling, then renames it."""
    target = os.path.abspath(target)
    if os.path.lexists(target):
        raise FileExistsError(f"{target} already exists, refusing to overwrite")
    parent, base = os.path.split(target)
    tmp = os.path.join(parent, f".{base}.installing-{os.getpid()}")
    try:
        files = folder_files(p, desk_html)
        os.makedirs(tmp)
        for rel, text in files.items():
            path = os.path.join(tmp, *rel.split("/"))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="") as fh:
                fh.write(text)
        os.rename(tmp, target)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return sorted(files)


NOTHING_CONNECTED = "Nothing was connected for you, and the pack holds no secret. Connect each one yourself."


def connector_report(p):
    """What the person has to connect: required and optional connectors with their stages and how to connect."""
    rows = []
    for c in p.get("connectors", []):
        rows.append({k: c.get(k, [] if k == "alternatives" else None) for k in
                     ("id", "label", "kind", "access", "purpose", "stages", "alternatives", "connect")})
    req = {c["id"] for c in p.get("connectors", []) if c.get("required")}
    return {"routine": p["id"], "title": p["title"],
            "required": [r for r in rows if r["id"] in req],
            "optional": [r for r in rows if r["id"] not in req],
            "note": NOTHING_CONNECTED}


def render_report(report):
    lines = [f"Connectors for {report['title']} ({report['routine']})", ""]
    for heading, key in (("Required", "required"), ("Optional", "optional")):
        lines.append(f"{heading}:")
        if not report[key]:
            lines.append("  none")
        for c in report[key]:
            lines.append(f"  - {c['label']} [{c['kind']}, {c['access']}]: {c['purpose']}")
            lines.append(f"    used by stages: {', '.join(c['stages']) or 'none'}")
            if c["alternatives"]:
                lines.append(f"    alternatives: {', '.join(c['alternatives'])}")
            lines.append(f"    how to connect: {c['connect']}")
        lines.append("")
    lines.append(report["note"])
    return "\n".join(lines)


# Export

EXPORT_DIRS = ("lib", "skills")
SKIP_PARTS = ("__pycache__",)


def _read_text(path):
    with open(path, encoding="utf-8", newline="") as fh:
        return fh.read()


def _confined(d, path):
    """Refuse a symlink, or a path that resolves outside the routine folder, before anything is read."""
    rel = os.path.relpath(path, d)
    if os.path.islink(path):
        raise PackError(f"{rel} is a symlink; export reads only real files inside the routine folder", io=True)
    root = os.path.realpath(d)
    if os.path.commonpath([root, os.path.realpath(path)]) != root:
        raise PackError(f"{rel} resolves outside the routine folder", io=True)
    return path


def default_meta(name):
    return {"format": FORMAT, "id": name, "version": "0.1.0", "title": name, "summary": f"The {name} routine.",
            "category": "general", "maturity": "unpiloted",
            "stages": [{"id": "run", "kind": "model", "title": "Run", "does": "Follows prompt.md."}],
            "connectors": []}


def _export_files(d):
    files = {}
    for top in EXPORT_DIRS:
        base = os.path.join(d, top)
        if not os.path.lexists(base):
            continue
        _confined(d, base)
        for root, dirs, names in os.walk(base):
            for x in dirs:
                _confined(d, os.path.join(root, x))
            dirs[:] = sorted(x for x in dirs if x not in SKIP_PARTS)
            for n in sorted(names):
                path = _confined(d, os.path.join(root, n))
                if n.endswith(".pyc") or n == ".DS_Store":
                    continue
                rel = os.path.relpath(path, d).replace(os.sep, "/")
                try:
                    files[rel] = _read_text(path)
                except UnicodeDecodeError:
                    files[rel] = "\x00"  # refused by validation as not text
    return files


def export(d):
    """The pack for a routine folder. Raises PackError(io=True) when unreadable, PackError(problems) when invalid."""
    toml_path = os.path.join(d, "routine.toml")
    for name in ("routine.toml", "prompt.md", "README.md", "definition.json", "pack.json"):
        if os.path.lexists(os.path.join(d, name)):
            _confined(d, os.path.join(d, name))
    try:
        with open(toml_path, "rb") as fh:
            routine = tomllib.load(fh)
    except FileNotFoundError:
        raise PackError(f"no routine.toml in {d}", io=True)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise PackError(f"cannot read {toml_path}: {exc}", io=True)
    head = routine.get("routine") if isinstance(routine.get("routine"), dict) else {}
    meta_path = os.path.join(d, "pack.json")
    problems = []
    if os.path.isfile(meta_path):
        with open(meta_path, "rb") as fh:
            meta = parse(fh.read(), what="pack.json")
        problems += [f"pack.json: '{k}' belongs in its own file, not pack.json" for k in BODY_KEYS if k in meta]
    else:
        meta = default_meta(str(head.get("name", "")))
    p = dict(meta)
    for k in BODY_KEYS:
        p.pop(k, None)
    p["routine"] = routine
    prompt_path, readme_path = os.path.join(d, "prompt.md"), os.path.join(d, "README.md")
    p["prompt"] = _read_text(prompt_path) if os.path.isfile(prompt_path) else ""
    p["readme"] = _read_text(readme_path) if os.path.isfile(readme_path) else ""
    def_path = os.path.join(d, "definition.json")
    if os.path.isfile(def_path):
        with open(def_path, "rb") as fh:
            p["definition"] = parse(fh.read(), what="definition.json")
    files = _export_files(d)
    if files:
        p["files"] = files
    p = {k: p[k] for k in PACK_KEYS if k in p} | {k: v for k, v in p.items() if k not in PACK_KEYS}
    problems += validate(p)
    if not problems and len(dumps(p).encode("utf-8")) > MAX_PACK_BYTES:
        problems.append(f"the pack would be over the {MAX_PACK_BYTES} byte limit, so install would refuse it")
    if problems:
        raise PackError(problems)
    return p


# The catalog: every templates/<id>/ with a pack.json, exported to catalog/<id>.json plus an index.

SHA256_RE = re.compile(r"^[0-9a-f]{64}\Z")


def catalog_entry(p, raw, path):
    """The index entry for one pack file's bytes."""
    head = p["routine"]["routine"]
    return {
        "id": p["id"], "version": p["version"], "title": p["title"], "summary": p["summary"],
        "category": p["category"], "maturity": p["maturity"], "type": head["type"], "schedule": head["schedule"],
        "path": path, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
        "connectors": [{"id": c["id"], "label": c["label"], "required": bool(c.get("required"))}
                       for c in p.get("connectors", [])],
        "inspiration": [link["url"] for link in p.get("inspiration", [])],
    }


def _catalog_outputs(templates_dir):
    """{file name: bytes} for every pack and the index. Raises PackError naming each bad template."""
    outputs, entries, problems = {}, [], []
    for name in sorted(os.listdir(templates_dir)):
        d = os.path.join(templates_dir, name)
        if not os.path.isdir(d) or not os.path.isfile(os.path.join(d, "pack.json")):
            continue
        try:
            p = export(d)
        except PackError as exc:
            problems += [f"{name}: {x}" for x in exc.problems]
            continue
        if p["id"] != name:
            problems.append(f"{name}: folder name must equal the pack id '{p['id']}'")
            continue
        raw = dumps(p).encode("utf-8")
        outputs[f"{name}.json"] = raw
        entries.append(catalog_entry(p, raw, f"{name}.json"))
    if problems:
        raise PackError(problems)
    index = {"format": CATALOG_FORMAT, "templates": entries}
    problems = validate_index(index)
    if problems:
        raise PackError(problems)
    outputs["index.json"] = (json.dumps(index, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    return outputs


def build_catalog(templates_dir, out_dir, check=False):
    """Write the catalog into out_dir; the sorted file names that changed. With check, write nothing.

    A pack file in out_dir that no template produces any more is stale and is removed. Nothing is
    written when any template fails, so a bad template never leaves a half-updated catalog.
    """
    outputs = _catalog_outputs(templates_dir)
    existing = set()
    if os.path.isdir(out_dir):
        existing = {n for n in os.listdir(out_dir) if n.endswith(".json") and os.path.isfile(os.path.join(out_dir, n))}
    changed = []
    for name, raw in outputs.items():
        path = os.path.join(out_dir, name)
        try:
            with open(path, "rb") as fh:
                same = fh.read() == raw
        except OSError:
            same = False
        if not same:
            changed.append(name)
    stale = sorted(existing - set(outputs))
    if not check:
        os.makedirs(out_dir, exist_ok=True)
        for name in changed:
            with open(os.path.join(out_dir, name), "wb") as fh:
                fh.write(outputs[name])
        for name in stale:
            os.remove(os.path.join(out_dir, name))
    return sorted(changed + stale)


def validate_index(idx):
    """Problems with a catalog index; empty when it is usable."""
    if not isinstance(idx, dict):
        return ["index must be a JSON object"]
    problems = [f"missing key '{k}'" for k in INDEX_KEYS if k not in idx]
    problems += _unknown(idx, INDEX_KEYS, "index")
    if "format" in idx and idx["format"] != CATALOG_FORMAT:
        problems.append(f"format must be {CATALOG_FORMAT}")
    entries = idx.get("templates", [])
    if not isinstance(entries, list):
        return problems + ["templates must be a list"]
    ids = []
    for i, e in enumerate(entries):
        where = f"templates[{i}]"
        if not isinstance(e, dict):
            problems.append(f"{where} must be an object")
            continue
        problems += [f"{where}: missing key '{k}'" for k in ENTRY_KEYS if k not in e]
        problems += _unknown(e, ENTRY_KEYS, where)
        eid = e.get("id")
        if not (isinstance(eid, str) and ID_RE.match(eid)):
            problems.append(f"{where}.id must be lowercase letters, digits and hyphens")
        else:
            ids.append(eid)
            if e.get("path") != f"{eid}.json":
                problems.append(f"{where}.path must be '{eid}.json', next to the index")
        if "version" in e and not (isinstance(e["version"], str) and SEMVER_RE.match(e["version"])):
            problems.append(f"{where}.version must be MAJOR.MINOR.PATCH")
        for key, limit in (("title", 80), ("summary", 280), ("schedule", 120)):
            if key in e:
                problems += _text(e, key, where, limit)
        if "category" in e and e["category"] not in CATEGORIES:
            problems.append(f"{where}.category must be one of {', '.join(CATEGORIES)}")
        if "maturity" in e and e["maturity"] not in MATURITY:
            problems.append(f"{where}.maturity must be one of {', '.join(MATURITY)}")
        if "type" in e and e["type"] not in schema.ROUTINE_TYPES:
            problems.append(f"{where}.type must be one of {', '.join(schema.ROUTINE_TYPES)}")
        b = e.get("bytes")
        if "bytes" in e and (isinstance(b, bool) or not isinstance(b, int) or not 0 <= b <= MAX_PACK_BYTES):
            problems.append(f"{where}.bytes must be a whole number from 0 to {MAX_PACK_BYTES}")
        if "sha256" in e and not (isinstance(e["sha256"], str) and SHA256_RE.match(e["sha256"])):
            problems.append(f"{where}.sha256 must be 64 lowercase hex characters")
        conns = e.get("connectors", [])
        if not isinstance(conns, list) or len(conns) > MAX_CONNECTORS:
            problems.append(f"{where}.connectors must be a list of at most {MAX_CONNECTORS}")
            conns = []
        for j, c in enumerate(conns):
            cw = f"{where}.connectors[{j}]"
            if not isinstance(c, dict):
                problems.append(f"{cw} must be an object")
                continue
            problems += [f"{cw}: missing key '{k}'" for k in ENTRY_CONNECTOR_KEYS if k not in c]
            problems += _unknown(c, ENTRY_CONNECTOR_KEYS, cw)
            if not (isinstance(c.get("id"), str) and ID_RE.match(c["id"])):
                problems.append(f"{cw}.id must be lowercase letters, digits and hyphens")
            if "label" in c:
                problems += _text(c, "label", cw, 80)
            if "required" in c and not isinstance(c["required"], bool):
                problems.append(f"{cw}.required must be true or false")
        links = e.get("inspiration", [])
        if not isinstance(links, list) or len(links) > MAX_INSPIRATION:
            problems.append(f"{where}.inspiration must be a list of at most {MAX_INSPIRATION} links")
            links = []
        for j, url in enumerate(links):
            if not (isinstance(url, str) and url.startswith("https://") and len(url) <= 300):
                problems.append(f"{where}.inspiration[{j}] must be an https link")
    if len(set(ids)) != len(ids):
        problems.append("templates has a duplicate id")
    elif ids != sorted(ids):
        problems.append("templates must be sorted by id")
    _scan(idx, "", problems)
    return [_safe(appmodel.redact(x)) for x in problems]


def load_index(src, opener=None):
    """A validated catalog index from a path or one https URL; raises PackError."""
    idx = parse(read_source(src, MAX_INDEX_BYTES, opener=opener), cap=MAX_INDEX_BYTES, what="index")
    problems = validate_index(idx)
    if problems:
        raise PackError(problems)
    return idx
