"""The Desk module boundary: desk/core/ is framework-free logic, desk/app/ is the React view and never reaches the
viewer runtime directly. Only core/store.js talks to window.claude."""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESK = os.path.join(ROOT, "skills", "routineos", "assets", "desk")
CORE = os.path.join(DESK, "core")
APP = os.path.join(DESK, "app")

CORE_FILES = {
    "actions.js", "bulk.js", "comments.js", "dates.js", "exporter.js", "ext.js", "keys.js", "lock.js", "members.js", "notify.js", "paging.js",
    "palette.js", "peek.js", "prefs.js", "queue.js", "record.js", "requests.js", "router.js", "schedule.js", "shared.js",
    "store.js", "strip.js", "viewerstate.js", "pages/approvals.js", "pages/browse.js", "pages/entity.js", "pages/history.js", "pages/runs.js",
    "pages/autorefresh.js", "pages/runs-health.js", "pages/settings.js", "pages/spec-query.js", "pages/spec-read.js", "pages/today.js", "pages/workers.js",
}
# window.<name> is allowed only here, and only for these names.
WINDOW_OK = {"store.js": {"localStorage", "sessionStorage", "crypto", "claude"},
             "prefs.js": {"localStorage", "sessionStorage", "crypto"},
             "lock.js": {"localStorage", "sessionStorage", "crypto"}}
WINDOW_RE = re.compile(r"\bwindow\.([A-Za-z_$][\w$]*)")


def walk(top, exts):
    out = {}
    for base, _dirs, files in os.walk(top):
        for f in files:
            if os.path.splitext(f)[1] in exts:
                path = os.path.join(base, f)
                with open(path, encoding="utf-8") as fh:
                    out[os.path.relpath(path, top).replace(os.sep, "/")] = fh.read()
    return out


class CoreBoundary(unittest.TestCase):
    def setUp(self):
        self.assertTrue(os.path.isdir(CORE), "desk/core/ is missing")
        self.core = walk(CORE, {".js", ".jsx", ".mjs"})

    def test_core_has_every_module(self):
        self.assertEqual(set(self.core), CORE_FILES)

    def test_core_never_touches_the_document(self):
        for name, text in self.core.items():
            with self.subTest(file=name):
                self.assertIsNone(re.search(r"\bdocument\.", text), "uses document.")
                used = set(re.findall(r"globalThis\.(document|location|history|navigator)\b", text))
                # The store reads navigator.onLine to tell a dropped connection from bad data.
                self.assertLessEqual(used, {"navigator"} if name == "store.js" else set())

    def test_window_only_for_storage_and_the_runtime(self):
        for name, text in self.core.items():
            with self.subTest(file=name):
                used = set(WINDOW_RE.findall(text))
                self.assertLessEqual(used, WINDOW_OK.get(name, set()))

    def test_core_has_no_react(self):
        for name, text in self.core.items():
            with self.subTest(file=name):
                self.assertNotRegex(text, r"""from\s+["']react""")
                self.assertNotRegex(text, r"""from\s+["']@mantine""")

    def test_only_the_store_calls_the_runtime(self):
        for name, text in self.core.items():
            if name == "store.js":
                continue
            with self.subTest(file=name):
                self.assertNotIn("claude.use", text)
                self.assertNotIn("window.claude", text)

    def test_core_is_plain_es_modules(self):
        for name, text in self.core.items():
            with self.subTest(file=name):
                self.assertNotIn("module.exports", text)
                self.assertNotRegex(text, r"\brequire\(")

    def test_store_is_the_runtime_door(self):
        self.assertIn("claude.use", self.core["store.js"])


class AppBoundary(unittest.TestCase):
    def test_app_never_calls_the_runtime(self):
        app = walk(APP, {".js", ".jsx", ".mjs"})
        self.assertTrue(app, "desk/app/ is empty")
        for name, text in app.items():
            with self.subTest(file=name):
                self.assertNotIn("claude.use", text)
                self.assertNotIn("window.claude", text)


if __name__ == "__main__":
    unittest.main()
