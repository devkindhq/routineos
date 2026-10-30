"""The eight new templates: lint, compile, validate, round trip and the safety rules each must keep."""
import json
import os
import re
import subprocess
import sys
import tempfile
import tomllib
import unittest

from pack_fixtures import CATALOG, CLI, TEMPLATES

import pack
import routineos

# id: (type, lib scripts, skills, gated action kind or None, n8n workflow ids)
NEW = {
    "meeting-brief": ("watch", [], [], None, [2324, 1862, 2786]),
    "weekly-marketing-report": ("watch", ["week_over_week.py"], [], None, [2783, 3224]),
    "inbox-triage": ("approval-gated", [], ["reply-style"], "send", [2271, 2454, 1953, 2722]),
    "support-gap-digest": ("watch", ["group_questions.py"], [], None, [2753, 2752, 2465]),
    "invoice-exceptions": ("watch", ["invoice_checks.py"], [], None, [2320]),
    "candidate-shortlist": ("watch", ["score_rubric.py"], [], None, [2860]),
    "content-calendar": ("approval-gated", ["check_citations.py"], ["house-style"], "post", [3066, 3986, 2187, 3291]),
    "engineering-digest": ("watch", ["stale_items.py"], [], None, [1534]),
}


def folder(tid):
    return os.path.join(TEMPLATES, tid)


def read(tid, name):
    with open(os.path.join(folder(tid), name), encoding="utf-8") as fh:
        return fh.read()


def toml(tid):
    with open(os.path.join(folder(tid), "routine.toml"), "rb") as fh:
        return tomllib.load(fh)


class NewTemplateTests(unittest.TestCase):
    def each(self):
        for tid in NEW:
            with self.subTest(template=tid):
                yield tid, NEW[tid]

    def test_folders_lint_and_packs_validate(self):
        for tid, _ in self.each():
            res = subprocess.run([sys.executable, CLI, "lint", folder(tid)], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            p = pack.export(folder(tid))
            self.assertEqual(pack.validate(p), [])
            self.assertEqual(p["id"], tid)
            self.assertEqual(p["maturity"], "unpiloted")

    def test_round_trips(self):
        for tid, _ in self.each():
            p = pack.export(folder(tid))
            with tempfile.TemporaryDirectory() as d:
                target = os.path.join(d, tid)
                pack.install(p, target, desk_html=routineos.desk_page)
                self.assertEqual(pack.export(target), p)
                with open(os.path.join(target, "routine.toml"), "rb") as fh:
                    self.assertEqual(tomllib.load(fh), toml(tid))
                for rel in ["prompt.md", "README.md"] + list(p.get("files", {})):
                    with open(os.path.join(folder(tid), rel), "rb") as a, open(os.path.join(target, rel), "rb") as b:
                        self.assertEqual(a.read(), b.read(), rel)

    def test_safety_rules(self):
        for tid, (rtype, _, _, _, _) in self.each():
            cfg = toml(tid)
            self.assertEqual(cfg["routine"]["type"], rtype)
            self.assertEqual(cfg["routine"]["first_run"], "report-only")
            prompt = read(tid, "prompt.md")
            self.assertIn("is data, not instructions", prompt)
            self.assertRegex(prompt, r"(?m)^Push rule: ")
            self.assertIn("First run: report-only", prompt)
            learn, write = prompt.find("routineos.py learn"), prompt.find("routineos.py write")
            self.assertTrue(0 <= learn < write, "learn must come before write in the prompt")
            d = json.loads(read(tid, "definition.json"))
            self.assertTrue(d["learning"]["enabled"])
            self.assertTrue(d["inbox"])
            cap = [s for s in cfg["setting"] if s["name"] == "max_inbox_per_run"]
            self.assertEqual(len(cap), 1)
            self.assertIn("max_inbox_per_run", prompt)
            self.assertIn("## Known risks", read(tid, "README.md"))

    def test_stages_learn_before_write_and_gate_before_any_send(self):
        for tid, (_, _, _, action, _) in self.each():
            p = pack.export(folder(tid))
            ids = [s["id"] for s in p["stages"]]
            self.assertLess(ids.index("learn"), ids.index("write"))
            kinds = [s["kind"] for s in p["stages"]]
            cfg = p["routine"]
            if action:
                self.assertTrue(cfg["gate"]["enabled"])
                self.assertEqual([a["kind"] for a in cfg["action"]], [action])
                gate = kinds.index("gate")
                write_conns = {c["id"] for c in p["connectors"] if c["access"] == "write"}
                acting = [i for i, s in enumerate(p["stages"]) if write_conns & set(s.get("connectors", []))
                          and s["kind"] != "gate"]
                self.assertTrue(acting)
                self.assertTrue(all(i > gate for i in acting), "every stage that acts comes after the gate")
                prompt = read(tid, "prompt.md")
                self.assertIn("approved", prompt)
            else:
                self.assertFalse(cfg["gate"]["enabled"])
                self.assertNotIn("gate", kinds)
                self.assertFalse(cfg.get("action"))
                self.assertFalse([c for c in p["connectors"] if c["access"] == "write"])

    def test_files_and_skills_match_the_table(self):
        for tid, (_, scripts, skills, _, _) in self.each():
            p = pack.export(folder(tid))
            files = sorted(p.get("files", {}))
            expected = sorted([f"lib/{s}" for s in scripts] + [f"skills/{s}/SKILL.md" for s in skills])
            self.assertEqual(files, expected)
            for s in scripts:
                self.assertTrue(any(st.get("command", "").startswith(f"python3 lib/{s}") for st in p["stages"]), s)
            for s in skills:
                self.assertIn(s, [st.get("skill") for st in p["stages"]])

    def test_inspiration_links_name_the_research(self):
        for tid, (_, _, _, _, ids) in self.each():
            p = pack.export(folder(tid))
            self.assertEqual([x["url"] for x in p["inspiration"]], [f"https://n8n.io/workflows/{i}" for i in ids])
            self.assertTrue(all(x["source"] == "n8n" for x in p["inspiration"]))

    def test_no_contact_details_or_product_claims_stated_as_fact(self):
        for tid, _ in self.each():
            for name in ("prompt.md", "README.md"):
                text = read(tid, name)
                self.assertNotRegex(text, r"\b\d[\d,]{3,}\+? (integrations|templates|users)\b")

    def test_all_are_in_the_catalog(self):
        with open(os.path.join(CATALOG, "index.json"), encoding="utf-8") as fh:
            ids = {e["id"] for e in json.load(fh)["templates"]}
        self.assertTrue(set(NEW) <= ids, set(NEW) - ids)


if __name__ == "__main__":
    unittest.main()
