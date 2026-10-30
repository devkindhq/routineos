#!/usr/bin/env python3
"""Bundle the Desk source modules into one self-contained index.html. Standard library only.

Usage: bundle_desk.py [--check] [--src DIR] [--out FILE]
--check exits 1 when the file on disk differs from a fresh bundle.
When a local site/ folder exists beside skills/ (the landing page, not tracked here) a default run also writes its copies:
site/desk.html (the same bundle on the static adapter) and site/tokens.css (src/tokens.css, byte for byte).
"""
import argparse
import json
import os
import re
import sys

DESK = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "desk")
CSS_ORDER = ("tokens.css", "shell.css")
JS_ORDER = ("ui.js", "icons.js", "store.js", "paging.js", "router.js", "actions.js", "bulk.js", "states.js", "pages/today.js", "pages/inbox.js", "pages/approvals.js", "pages/suggestions.js",
            "pages/browse.js",
            "pages/entity.js", "pages/views.js", "pages/settings.js", "pages/workers.js", "pages/runs.js", "pages/history.js", "exporter.js", "notify.js", "palette.js", "shell.js")
FONTS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Public+Sans:wght@400;500;600;700&display=swap"
DEFAULT_CONFIG = '{"store": "db"}'
SITE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(DESK)))), "site")
SITE_CONFIG = '{"store": "static", "snapshot": "desk-demo.json", "workspace": "Jobs watch demo"}'
PLUGIN_JSON = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(DESK)))), ".claude-plugin", "plugin.json")
VERSION_MARK = "__ROUTINEOS_VERSION__"

TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{fonts}">
<style>
{css}
</style>
</head>
<body>
<div id="desk-root"></div>
<script type="application/json" id="desk-config">{config}</script>
<script>
(function () {{
"use strict";
{js}
}})();
</script>
</body>
</html>
"""


class BundleError(Exception):
    pass


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def shell_name(src):
    m = re.search(r'const SHELL_NAME = "([^"]+)";', _read(os.path.join(src, "shell.js")))
    if not m:
        raise BundleError("shell.js must declare const SHELL_NAME")
    return m.group(1)


def _part(src, name, closer):
    text = _read(os.path.join(src, name))
    if closer in text.lower():
        raise BundleError(f"{name} contains {closer}, which would end the inline block")
    return f"/* src/{name} */\n{text.rstrip()}\n"


def plugin_version():
    """The plugin.json version, or "" when the bundler runs outside the plugin layout."""
    try:
        version = json.loads(_read(PLUGIN_JSON)).get("version")
    except (OSError, ValueError, AttributeError):
        return ""
    return version if isinstance(version, str) and re.fullmatch(r"[0-9A-Za-z.+-]+", version) else ""


def build(src=None, config=DEFAULT_CONFIG):
    src = src or os.path.join(DESK, "src")
    missing = [n for n in CSS_ORDER + JS_ORDER if not os.path.isfile(os.path.join(src, n))]
    if missing:
        raise BundleError("missing source file(s): " + ", ".join(missing))
    css = "\n".join(_part(src, n, "</style") for n in CSS_ORDER)
    js = "\n".join(_part(src, n, "</script") for n in JS_ORDER).replace(VERSION_MARK, plugin_version())
    return TEMPLATE.format(title="RoutineOS " + shell_name(src), fonts=FONTS, css=css.rstrip(), js=js.rstrip(),
                           config=config)


def main(argv=None):
    p = argparse.ArgumentParser(prog="bundle_desk")
    p.add_argument("--check", action="store_true", help="exit 1 if the bundle on disk is stale")
    p.add_argument("--src", help="source directory (default assets/desk/src)")
    p.add_argument("--out", help="output file (default assets/desk/index.html)")
    args = p.parse_args(argv)
    out = args.out or os.path.join(DESK, "index.html")
    try:
        outputs = [(out, build(args.src))]
        if not args.out and not args.src and os.path.isdir(SITE):
            outputs.append((os.path.join(SITE, "desk.html"), build(config=SITE_CONFIG)))
            outputs.append((os.path.join(SITE, "tokens.css"), _read(os.path.join(DESK, "src", "tokens.css"))))
    except (BundleError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.check:
        stale = [path for path, text in outputs if (_read(path) if os.path.isfile(path) else None) != text]
        for path in stale:
            print(f"stale: {path} differs from src; run bundle_desk.py")
        if stale:
            return 1
        for path, _ in outputs:
            print(f"ok: {path} is current")
        return 0
    for path, text in outputs:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"ok: wrote {path} ({len(text.encode('utf-8'))} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
