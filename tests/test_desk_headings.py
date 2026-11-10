"""Every routed Desk page state names itself with an h1#page-title (focus target and screen reader heading)."""
import re
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "skills/routineos/assets/desk/app"
# Full-screen states drawn outside the routed outlet.
OUTSIDE_OUTLET = {"lock.jsx"}
H1 = re.compile(r"<Title\b[^>]*\border=\{1\}[^>]*>")


class HeadingTests(unittest.TestCase):
    def test_every_routed_h1_carries_page_title(self):
        bad, seen = [], 0
        for f in sorted(APP.rglob("*.jsx")):
            if f.name in OUTSIDE_OUTLET:
                continue
            for m in H1.finditer(f.read_text()):
                seen += 1
                if 'id="page-title"' not in m.group(0):
                    bad.append(f"{f.relative_to(APP)}: {m.group(0)}")
        self.assertEqual(bad, [])
        self.assertGreater(seen, 10, "the scan found the page headings")

    def test_record_page_states_have_a_page_heading(self):
        text = (APP / "pages" / "Entity.jsx").read_text()
        # Loading, read-error and not-found states of the full record page carry the heading.
        self.assertGreaterEqual(text.count('<Title id="page-title" order={1}>Record</Title>'), 2, "loading and read-error")
        self.assertIn('<Title id="page-title" order={1}>Not found</Title>', text)


if __name__ == "__main__":
    unittest.main()
