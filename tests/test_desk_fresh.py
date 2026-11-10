"""The committed desk/index.html is the build of the current sources: its src-hash meta tag matches bundle_desk.src_hash,
and (RUN_DESK_BUILD=1 with node on PATH) a fresh Vite build gives the same bytes."""
import os
import re
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))

import bundle_desk  # noqa: E402

DESK = os.path.join(ROOT, "skills", "routineos", "assets", "desk")
HTML = os.path.join(DESK, "index.html")
META_RE = re.compile(r'<meta name="desk-src-hash" content="([0-9a-f]{64})">')


def committed():
    with open(HTML, "rb") as fh:
        return fh.read()


class FreshTests(unittest.TestCase):
    def test_src_hash_matches_the_committed_meta_tag(self):
        m = META_RE.search(committed().decode("utf-8"))
        self.assertIsNotNone(m, "desk/index.html has no desk-src-hash meta tag")
        self.assertEqual(m.group(1), bundle_desk.src_hash(DESK),
                         "desk/index.html is stale; run npm --prefix skills/routineos/assets/desk run build")

    def test_src_hash_changes_with_a_source_byte(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            for rel in ("core/a.js", "app/b.jsx", "package.json", "package-lock.json", "vite.config.js",
                        "index.template.html", "core/.DS_Store", "node_modules/x.js", "dist/index.html"):
                path = os.path.join(tmp, rel)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w") as fh:
                    fh.write(rel)
            before = bundle_desk.src_hash(tmp)
            for ignored in ("core/.DS_Store", "node_modules/x.js", "dist/index.html"):
                with open(os.path.join(tmp, ignored), "w") as fh:
                    fh.write("changed")
            self.assertEqual(bundle_desk.src_hash(tmp), before)
            with open(os.path.join(tmp, "core", "a.js"), "w") as fh:
                fh.write("changed")
            self.assertNotEqual(bundle_desk.src_hash(tmp), before)

    def test_check_passes_on_the_committed_page(self):
        self.assertEqual(bundle_desk.main(["--check"]), 0)

    @unittest.skipUnless(os.environ.get("RUN_DESK_BUILD") == "1" and shutil.which("node"),
                         "set RUN_DESK_BUILD=1 with node on PATH to rebuild the Desk")
    def test_a_fresh_build_is_byte_identical(self):
        before = committed()
        subprocess.run(["npm", "--prefix", DESK, "run", "build"], check=True, capture_output=True)
        self.assertEqual(committed(), before)


if __name__ == "__main__":
    unittest.main()
