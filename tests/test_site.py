import contextlib
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
DESK_HTML = ROOT / "skills" / "routineos" / "assets" / "desk" / "index.html"
sys.path.insert(0, str(ROOT / "skills" / "routineos" / "scripts"))

import bundle_desk  # noqa: E402
GENERATOR = ROOT / "templates" / "jobs-watch" / "demo" / "generate.py"
EMOJI = re.compile("[" + chr(0x1F000) + "-" + chr(0x1FAFF) + chr(0x2600) + "-" + chr(0x27BF) + chr(0x2B00) + "-" + chr(0x2BFF) + chr(0xFE0F) + "]")


class Collector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []
        self.ids = set()
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.tags.append((tag, a))
        if "id" in a:
            self.ids.add(a["id"])
        if tag == "a" and "href" in a:
            self.hrefs.append(a["href"])


class SiteDeskTest(unittest.TestCase):
    """bundle_desk.py writes site/desk.html: the prebuilt Desk with SITE_CONFIG injected. Runs without a real site/."""

    def test_default_run_writes_the_static_desk(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(bundle_desk, "SITE", tmp), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(bundle_desk.main([]), 0)
            desk = (Path(tmp) / "desk.html").read_text(encoding="utf-8")
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["desk.html"])
        found = re.search(r'<script type="application/json" id="desk-config">(.*?)</script>', desk, re.S)
        self.assertIsNotNone(found)
        self.assertEqual(json.loads(found.group(1) if found else "{}"),
                         {"store": "static", "snapshot": "desk-demo.json", "workspace": "Jobs watch demo"})
        self.assertNotIn(bundle_desk.VERSION_MARK, desk)
        strip = lambda h: re.sub(r'(id="desk-config">).*?(</script>)', r"\1\2", h, flags=re.S)
        self.assertEqual(strip(desk), strip(DESK_HTML.read_text(encoding="utf-8")).replace(
            bundle_desk.VERSION_MARK, bundle_desk.plugin_version()))

    def test_no_site_folder_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(bundle_desk, "SITE", str(Path(tmp) / "site")), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(bundle_desk.main([]), 0)
            self.assertFalse((Path(tmp) / "site").exists())


@unittest.skipUnless((SITE / "index.html").is_file(), "the landing page is not tracked here; site/ is absent")
class SiteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (SITE / "index.html").read_text(encoding="utf-8")
        cls.css = (SITE / "styles.css").read_text(encoding="utf-8")
        cls.p = Collector()
        cls.p.feed(cls.html)

    def test_viewport_meta(self):
        metas = [a for t, a in self.p.tags if t == "meta" and a.get("name") == "viewport"]
        self.assertEqual(len(metas), 1)
        self.assertIn("width=device-width", metas[0]["content"])

    def test_dark_mode_and_override(self):
        tokens = (SITE / "tokens.css").read_text(encoding="utf-8")
        self.assertIn("prefers-color-scheme: dark", tokens)
        self.assertIn(':root:not([data-theme="light"])', tokens)
        self.assertIn(':root[data-theme="dark"]', tokens)
        self.assertRegex(self.css, r"body\s*{[^}]*background: var\(--bg\)")

    def test_exactly_one_h1(self):
        self.assertEqual(sum(1 for t, _ in self.p.tags if t == "h1"), 1)

    def test_no_external_scripts(self):
        for t, a in self.p.tags:
            if t == "script":
                self.assertNotIn("src", a)

    def test_no_em_dash_or_emoji(self):
        for name, text in (("html", self.html), ("css", self.css),
                           ("readme", (SITE / "README.md").read_text(encoding="utf-8"))):
            self.assertNotIn(chr(0x2014), text, name)
            self.assertIsNone(EMOJI.search(text), name)

    def test_anchors_resolve(self):
        anchors = [h for h in self.p.hrefs if h.startswith("#") and len(h) > 1]
        self.assertTrue(anchors)
        for h in anchors:
            self.assertIn(h[1:], self.p.ids, h)

    def test_required_content(self):
        self.assertIn("https://github.com/devkindhq/routineos", self.html)
        self.assertIn("MIT", self.html)
        self.assertIn("https://docs.routineos.org/introduction/honest-limits", self.html)
        self.assertIn("routineos.py new", self.html)
        for word in ("Model", "Migration", "Job", "Scheduler", "View", "Credentials", "Generators", "Console"):
            self.assertIn(word, self.html)

    def test_no_first_pass_text(self):
        for text in (self.html, (SITE / "README.md").read_text(encoding="utf-8")):
            self.assertNotIn("first pass", text.lower())

    def test_shared_tokens_file(self):
        links = [a["href"] for t, a in self.p.tags if t == "link" and a.get("rel") == "stylesheet"]
        self.assertLess(links.index("tokens.css"), links.index("styles.css"))
        self.assertIsNone(re.search(r"#[0-9a-fA-F]{3,8}\b", self.css), "colours come from tokens.css only")
        self.assertNotRegex(self.css, r"--(bg|surface|line|ink|muted|accent|ok|warn|fail)[a-z-]*\s*:")
        for old in ("--ground", "--rule", "--on-accent"):
            self.assertNotIn(old, self.css)

    def test_hero_contains_desk_mount(self):
        found = re.search(r'<section class="hero.*?</section>', self.html, re.S)
        self.assertIsNotNone(found)
        hero = found.group(0) if found else ""
        self.assertIn('<iframe', hero)
        self.assertIn('src="desk.html"', hero)
        self.assertLess(hero.index("<h1"), hero.index("<iframe"), "words come before the Desk")
        self.assertIn("demo data", hero.lower())
        frames = [a for t, a in self.p.tags if t == "iframe"]
        self.assertEqual(len(frames), 1)
        self.assertTrue(frames[0].get("title"))

    def test_desk_page_is_the_prebuilt_on_the_static_adapter(self):
        want = bundle_desk.inject(DESK_HTML.read_text(encoding="utf-8"), bundle_desk.SITE_CONFIG,
                                  bundle_desk.plugin_version(), [])
        self.assertEqual((SITE / "desk.html").read_text(encoding="utf-8"), want)

    def test_demo_snapshot_is_generator_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            snap = Path(tmp) / "snap.json"
            subprocess.run([sys.executable, str(GENERATOR), "--out", tmp, "--snapshot", str(snap)],
                           check=True, capture_output=True)
            self.assertEqual(snap.read_bytes(), (SITE / "desk-demo.json").read_bytes())

    def test_no_javascript_fallback(self):
        self.assertIn("<noscript>", self.html)
        head = self.html.split("</head>")[0]
        self.assertIn("<noscript>", head, "the frame is hidden when scripts are off")

    def test_approved_key_copy(self):
        self.assertIn("Rails for Claude routines.", self.html)
        self.assertIn("Claude runs the routines; nothing goes out without your yes.", self.html)
        self.assertIn("Read the quick start", self.html)
        self.assertIn("Read the limits first", self.html)

    def test_sections_kept(self):
        for sid in ("rails", "how", "settings", "safety", "limits", "status"):
            self.assertIn(sid, self.p.ids)

    def test_no_stock_phrases(self):
        low = self.html.lower()
        for word in ("ai-powered", "smart", "magic", "effortless", "unlock", "supercharge", "seamless", "game-changing"):
            self.assertNotIn(word, low)

    def test_images_have_alt(self):
        for t, a in self.p.tags:
            if t == "img":
                self.assertIn("alt", a)

    def test_html_lang(self):
        self.assertTrue(any(t == "html" and a.get("lang") for t, a in self.p.tags))


if __name__ == "__main__":
    unittest.main()
