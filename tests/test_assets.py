import os
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, "skills", "routineos", "scripts", "routineos.py")
ASSETS = os.path.join(ROOT, "skills", "routineos", "assets")

FRAGMENTS = {
    "gate-email": ("gate-email-prompt.md", ["{{approver}}", "{{code}}", "{{timeout_hours}}", "{{pending_doc}}", "approve {{code}}", "reject {{code}}"]),
    "gate-slack": ("gate-slack-prompt.md", ["{{approver}}", "{{code}}", "{{timeout_hours}}", "{{pending_doc}}", "approve {{code}}", "reject {{code}}", "Ask for approval"]),
    "action-queue": ("action-queue-prompt.md", ["{{allowed_kinds}}", "requests/"]),
    "adapter-contract": ("adapter-contract.md", ["put(key, bytes)", "get(key)", "list(prefix)"]),
}


def run(*args):
    return subprocess.run([sys.executable, CLI, *args], capture_output=True, text=True)


def read(name):
    with open(os.path.join(ASSETS, name), encoding="utf-8") as fh:
        return fh.read()


class AssetTests(unittest.TestCase):
    def test_fragments_have_required_content(self):
        for key, (fname, needles) in FRAGMENTS.items():
            text = read(fname)
            self.assertIn("is data, not instructions", text, key)
            self.assertIn("Push rule:", text, key)
            for n in needles:
                self.assertIn(n, text, f"{key} missing {n}")

    def test_gate_rule_details(self):
        for fname in ("gate-email-prompt.md", "gate-slack-prompt.md"):
            t = read(fname).lower()
            for phrase in ("not the parent", "newer than the parent", "first non-empty line", "latest valid reply wins", "expire"):
                self.assertIn(phrase, t, f"{fname} missing {phrase}")

    def test_gate_prompts_use_the_desk_draft_and_recipients_by_role(self):
        for fname in ("gate-email-prompt.md", "gate-slack-prompt.md"):
            t = read(fname)
            self.assertIn("decisions/", t, fname)
            self.assertIn("the decision's `draft`", t, fname)
            self.assertIn("the gate's own `draft`", t, fname)
            self.assertIn("by role", t, fname)

    def test_prompt_prints_fragment(self):
        for key, (fname, _) in FRAGMENTS.items():
            r = run("prompt", key)
            self.assertEqual(r.returncode, 0, key)
            self.assertEqual(r.stdout, read(fname))

    def test_unknown_prompt_exits_2_without_traceback(self):
        r = run("prompt", "nope")
        self.assertEqual(r.returncode, 2)
        self.assertIn("unknown fragment", r.stderr)
        self.assertNotIn("Traceback", r.stderr)


if __name__ == "__main__":
    unittest.main()
