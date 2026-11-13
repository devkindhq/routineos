#!/usr/bin/env python3
"""Turn the committed single-file Desk into a routine's page. Standard library only.

Vite builds the Desk (npm --prefix skills/routineos/assets/desk run build) into assets/desk/index.html, which is
committed. Python never rebuilds it: inject() writes the config block, the plugin version and a routine's custom
components into that file.

Usage: bundle_desk.py [--check]
--check exits 1 when assets/desk/index.html or assets/desk/index.blueprint.html (the build variant with the Blueprint
page, npm run build:blueprint) was not built from the current sources (its desk-src-hash meta tag).
When a local site/ folder exists beside skills/ (the landing page, not tracked here) a default run writes
site/desk.html: the same page on the static adapter.
"""
import argparse
import hashlib
import json
import os
import re
import sys

DESK = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "desk")
HTML = os.path.join(DESK, "index.html")
BLUEPRINT_HTML = os.path.join(DESK, "index.blueprint.html")
CONFIG_KEYS = ("store", "snapshot", "workspace", "components", "tour", "blueprint")
CONFIG_RE = re.compile(r'(<script type="application/json" id="desk-config">)(.*?)(</script>)', re.S)
COMPONENTS_MARK = "<!-- desk-components -->"
SITE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(DESK)))), "site")
SITE_CONFIG = {"store": "static", "snapshot": "desk-demo.json", "workspace": "Jobs watch demo"}
PLUGIN_JSON = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(DESK)))), ".claude-plugin", "plugin.json")
VERSION_MARK = "__ROUTINEOS_VERSION__"
VERSION_RE = re.compile(r"[0-9A-Za-z.+-]*")
COMPONENT_ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,31}$")
# The inputs of the Vite build. vite.config.js computes the same hash and writes it into the page.
HASH_DIRS = ("core", "app")
HASH_FILES = ("package.json", "package-lock.json", "vite.config.js", "index.template.html")
# The Blueprint variant also builds blueprint/ and its own template.
BLUEPRINT_DIRS = ("core", "app", "blueprint")
BLUEPRINT_FILES = HASH_FILES + ("blueprint.template.html",)
META_RE = re.compile(r'<meta name="desk-src-hash" content="([0-9a-f]{64})">')


class BundleError(Exception):
    pass


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def src_hash(root=DESK, dirs=HASH_DIRS, files=HASH_FILES):
    """sha256 hex over the build inputs under `root`: each file's "/" relative path and bytes, in sorted path order.
    Dotfiles are skipped."""
    paths = [f for f in files if os.path.isfile(os.path.join(root, f))]
    for top in dirs:
        for base, subdirs, names in os.walk(os.path.join(root, top)):
            subdirs[:] = [d for d in subdirs if not d.startswith(".")]
            paths += [os.path.relpath(os.path.join(base, f), root).replace(os.sep, "/") for f in names
                      if not f.startswith(".")]
    h = hashlib.sha256()
    for rel in sorted(paths):
        with open(os.path.join(root, rel), "rb") as fh:
            h.update(rel.encode("utf-8") + b"\0" + fh.read() + b"\0")
    return h.hexdigest()


def plugin_version():
    """The plugin.json version, or "" when the bundler runs outside the plugin layout."""
    try:
        version = json.loads(_read(PLUGIN_JSON)).get("version")
    except (OSError, ValueError, AttributeError):
        return ""
    return version if isinstance(version, str) and re.fullmatch(r"[0-9A-Za-z.+-]+", version) else ""


def component_js(cid, factory, text, meta=None):
    """A routine's custom component as script text that registers its factory in window.DESK_COMPONENTS.

    Each component gets its own classic script, so one that does not parse or that redeclares a name loses only
    itself."""
    if not (isinstance(cid, str) and COMPONENT_ID_RE.match(cid)):
        raise BundleError(f"component id {cid!r} is not a component id")
    if factory != "component_" + cid.replace("-", "_"):
        raise BundleError(f"component {cid}: factory must be component_{cid.replace('-', '_')}")
    ext = ""
    if meta and meta.get("slot") not in (None, "field-cell"):
        keep = {k: meta[k] for k in ("slot", "types", "view", "title", "nav", "summary", "verbs", "placement", "prefs") if k in meta}
        blob = json.dumps(keep).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
        ext = (f";(window.DESK_EXTENSIONS = window.DESK_EXTENSIONS || Object.create(null))[{json.dumps(cid)}] "
               f"= (function (e) {{ Object.keys(e).forEach(function (k) {{ if (e[k] && typeof e[k] === 'object') Object.freeze(e[k]); }}); "
               f"return Object.freeze(e); }})({blob});\n")
    return (f'(function () {{\n"use strict";\n/* desk/components/{cid}/{cid}.js */\n{text.rstrip()}\n'
            f";(window.DESK_COMPONENTS = window.DESK_COMPONENTS || Object.create(null))[{json.dumps(cid)}] = {factory};\n"
            f"{ext}"
            "})();")


def config_json(cfg):
    """The desk-config block's text: the known keys of cfg, escaped so no value can close the script element."""
    if "tour" in cfg and not isinstance(cfg["tour"], bool):
        raise BundleError("config tour must be true or false")
    text = json.dumps({k: cfg[k] for k in CONFIG_KEYS if k in cfg})
    return text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def inject(html, config, version, components):
    """The built page with its config block, plugin version and custom components (script texts, in order) filled in."""
    if not CONFIG_RE.search(html):
        raise BundleError("the page has no desk-config block")
    if not VERSION_RE.fullmatch(version):
        raise BundleError(f"version {version!r} is not a version")
    text = config_json(config)
    html = CONFIG_RE.sub(lambda m: m.group(1) + text + m.group(3), html, count=1).replace(VERSION_MARK, version)
    if not components:
        return html
    if COMPONENTS_MARK not in html:
        raise BundleError("the page has no desk-components marker")
    scripts = []
    for js in components:
        for bad in ("</script", "<script", "<!--"):
            if bad in js.lower():
                raise BundleError(f"a component contains {bad}, which would end or swallow its inline block")
        scripts.append(f"<script>\n{js}\n</script>\n")
    return html.replace(COMPONENTS_MARK, "".join(scripts) + COMPONENTS_MARK, 1)


def _safe_target(out_dir, rel):
    """Absolute path of relative path rel inside out_dir. Raises BundleError for an absolute, backslash, drive-letter,
    control-character, empty, "." or ".." path, one whose target or any parent below out_dir is a symlink, or one
    resolving outside out_dir."""
    parts = rel.split("/") if isinstance(rel, str) else []
    if (not parts or "\\" in rel or re.match(r"[A-Za-z]:", rel) or any(ord(c) < 32 or ord(c) == 127 for c in rel)
            or any(seg in ("", ".", "..") for seg in parts)):
        raise BundleError(f"unsafe path {rel!r}")
    cur = out_dir
    for seg in parts:
        cur = os.path.join(cur, seg)
        if os.path.islink(cur):
            raise BundleError(f"path {rel!r} passes through a symlink")
    root = os.path.realpath(out_dir)
    target = os.path.realpath(os.path.join(root, *parts))
    if os.path.commonpath([root, target]) != root or target == root:
        raise BundleError(f"path {rel!r} resolves outside {out_dir}")
    return os.path.join(out_dir, *parts)


def _guard_folder(anchor, out_dir):
    """Create out_dir below anchor one folder at a time. Raises BundleError when out_dir is not inside anchor, or a
    folder from anchor down to out_dir is a symlink or not a folder."""
    rel = os.path.relpath(os.path.abspath(out_dir), os.path.abspath(anchor))
    parts = rel.split(os.sep)
    if rel == "." or any(p in ("", "..") for p in parts):
        raise BundleError(f"{out_dir} is outside {anchor}")
    cur = anchor
    for seg in parts:
        cur = os.path.join(cur, seg)
        if os.path.islink(cur):
            raise BundleError(f"{cur} is a symlink; refusing to write through it")
        if not os.path.exists(cur):
            os.mkdir(cur)
        elif not os.path.isdir(cur):
            raise BundleError(f"{cur} is not a folder")
    root = os.path.realpath(anchor)
    if os.path.commonpath([root, os.path.realpath(out_dir)]) != root:
        raise BundleError(f"{out_dir} resolves outside {anchor}")


def _listed_paths(out_dir):
    """Paths a previous build listed in out_dir/files.json, in the old split format {"files": [{"path": ...}]} or as a
    plain list; None when there is no readable manifest. A symlinked manifest is never read."""
    path = os.path.join(out_dir, "files.json")
    if os.path.islink(path) or not os.path.isfile(path):
        return None
    try:
        data = json.loads(_read(path))
        return [f["path"] for f in data["files"]] if isinstance(data, dict) else list(data)
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _prune(out_dir, files):
    """Remove each path a previous files.json listed that `files` no longer has, and the folders that leaves empty.
    Unsafe and symlinked entries are skipped with a warning; nothing outside out_dir is touched."""
    for rel in _listed_paths(out_dir) or []:
        if rel in files or rel == "files.json":
            continue
        try:
            target = _safe_target(out_dir, rel)
        except BundleError as exc:
            print(f"warning: skipping unsafe manifest path {rel!r}: {exc}", file=sys.stderr)
            continue
        if not os.path.isfile(target):
            continue
        os.remove(target)
        print(f"removed {rel} (listed by an earlier build)")
        parts = rel.split("/")[:-1]
        while parts:
            folder = os.path.join(out_dir, *parts)
            if os.path.islink(folder) or not os.path.isdir(folder) or os.listdir(folder):
                break
            os.rmdir(folder)
            parts.pop()


def _write_nofollow(target, text):
    """Write text to target, failing rather than following a symlink put there after the checks."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    try:
        fd = os.open(target, flags, 0o644)
    except OSError as exc:
        if os.path.islink(target):
            raise BundleError(f"{target} is a symlink; refusing to write through it") from exc
        raise
    with os.fdopen(fd, "wb") as fh:
        fh.write(text.encode("utf-8") if isinstance(text, str) else text)


def write_guarded(anchor, out_dir, files, manifest=False):
    """Write {relative path: text} into out_dir, a folder inside anchor (the routine folder); returns the paths
    written. Raises BundleError before writing anything when out_dir or any folder between anchor and out_dir is a
    symlink, when out_dir resolves outside anchor, or when a target path is unsafe, passes through a symlink or
    resolves outside out_dir. Files are opened without following symlinks.

    manifest=True is for a folder published whole (dashboard/artifact). Without a readable files.json, a folder
    holding anything besides `files` is refused. With one, the paths it listed that `files` no longer has are removed;
    any other leftover is named on stderr."""
    _guard_folder(anchor, out_dir)
    targets = {rel: _safe_target(out_dir, rel) for rel in files}
    if manifest:
        if any(n not in files for n in os.listdir(out_dir)) and _listed_paths(out_dir) is None:
            raise BundleError(f"refusing to write into non-empty {out_dir} without files.json")
        _prune(out_dir, files)
        left = sorted(n for n in os.listdir(out_dir) if n not in files)
        if left:
            print(f"warning: {out_dir} also holds {', '.join(left)}, which the page does not use", file=sys.stderr)
    for rel, text in files.items():
        _write_nofollow(targets[rel], text)
    return list(files)


def main(argv=None):
    p = argparse.ArgumentParser(prog="bundle_desk")
    p.add_argument("--check", action="store_true", help="exit 1 if assets/desk/index.html is stale")
    args = p.parse_args(argv)
    try:
        html = _read(HTML)
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.check:
        stale = 0
        for path, dirs, files in ((HTML, HASH_DIRS, HASH_FILES), (BLUEPRINT_HTML, BLUEPRINT_DIRS, BLUEPRINT_FILES)):
            try:
                m = META_RE.search(_read(path))
            except OSError as exc:
                print(f"error: {exc}", file=sys.stderr)
                return 2
            if not m or m.group(1) != src_hash(DESK, dirs, files):
                print(f"stale: {path} was not built from the current sources; run npm --prefix {DESK} run "
                      f"{'build' if path == HTML else 'build:blueprint'}")
                stale = 1
            else:
                print(f"ok: {path} is current")
        return stale
    if not os.path.isdir(SITE):
        print(f"ok: nothing to write; {HTML} is built by npm --prefix {DESK} run build")
        return 0
    try:
        page = inject(html, SITE_CONFIG, plugin_version(), [])
        out = os.path.join(SITE, "desk.html")
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(page)
    except (BundleError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"ok: wrote {out} ({len(page.encode('utf-8'))} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
