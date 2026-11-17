"""The Desk library registry reader (stdlib only).

desk/libraries.json lists the libraries bundled into the prebuilt Desk and exposed to approved raw React pages.
The Vite build reads the same file; desk/lib-exports.json (names only, written by the build) lists what each
library exports. This module loads and checks both.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DESK = os.path.join(os.path.dirname(HERE), "assets", "desk")
LIBRARIES_JSON = os.path.join(DESK, "libraries.json")
EXPORTS_JSON = os.path.join(DESK, "lib-exports.json")
PACKAGE_JSON = os.path.join(DESK, "package.json")

LICENCES = ("MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause")
REQUIRED = ("specifier", "package", "version", "provides", "exports", "gzip_cost", "licence", "raise_reason")
OPTIONAL = ("css", "provider")


class LibraryError(Exception):
    pass


def load_libraries(path=LIBRARIES_JSON):
    """Return the registry entries. Raises LibraryError when the file is unreadable or not the expected shape."""
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        raise LibraryError("cannot read %s: %s" % (path, exc))
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("libraries"), list):
        raise LibraryError('%s must be {"version": 1, "libraries": [...]}' % path)
    for entry in data["libraries"]:
        if not isinstance(entry, dict):
            raise LibraryError("%s: every library must be an object" % path)
    return data["libraries"]


def check_libraries(entries, package_json):
    """Return a list of problems: bad entries, and versions that differ from desk/package.json."""
    problems = []
    seen = set()
    pinned = {}
    for section in ("dependencies", "devDependencies"):
        pinned.update(package_json.get(section) or {})
    for entry in entries:
        spec = entry.get("specifier")
        if not isinstance(spec, str) or not spec:
            problems.append("an entry has no specifier")
            continue
        if spec in seen:
            problems.append("%s: duplicate specifier" % spec)
        seen.add(spec)
        for key in REQUIRED:
            if key not in entry:
                problems.append("%s: missing key %s" % (spec, key))
        for key in entry:
            if key not in REQUIRED and key not in OPTIONAL:
                problems.append("%s: unknown key %s" % (spec, key))
        if entry.get("licence") not in LICENCES:
            problems.append("%s: licence %r is not one of %s" % (spec, entry.get("licence"), ", ".join(LICENCES)))
        if not str(entry.get("raise_reason") or "").strip():
            problems.append("%s: raise_reason is empty" % spec)
        package = entry.get("package", spec)
        if package not in pinned:
            problems.append("%s: %s is not in desk/package.json" % (spec, package))
        elif pinned[package] != entry.get("version"):
            problems.append("%s: registry version %s but desk/package.json pins %s"
                            % (spec, entry.get("version"), pinned[package]))
    return problems


def versions(entries):
    """Map each specifier to its pinned version."""
    return {e["specifier"]: e["version"] for e in entries}


def load_exports(path=EXPORTS_JSON):
    """Return {specifier: [export names]} from the build output ({"version": 1, "exports": {...}}), or {} when the
    file is missing."""
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:
        raise LibraryError("cannot read %s: %s" % (path, exc))
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("exports"), dict):
        raise LibraryError('%s must be {"version": 1, "exports": {specifier: [names]}}' % path)
    return data["exports"]
