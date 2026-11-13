"""Fixes from the blind audit of 0.12.0: write_approval by parsing, redaction of extra secret shapes, the approve screen,
and the fields the approval hash covers."""
import os
import sys
import tomllib
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))
sys.path.insert(0, ROOT + "/tests")

import blueprint  # noqa: E402
import routineos  # noqa: E402
from test_blueprint_cli import Base, read, run, run_tty  # noqa: E402


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def block():
    return blueprint.approval_block(2, "2026-11-13", "sha256:n", "Y")


class WriteApprovalParsingTests(Base):
    def test_quoted_header_is_replaced_not_duplicated(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        write(path, read(path).decode() + '\n["approval"]\nversion = 1\ndate = "2020-01-01"\nhash = "sha256:old"\napproved_by = "X"\n')
        blueprint.write_approval(path, block())
        cfg = tomllib.loads(read(path).decode())
        self.assertEqual(cfg["approval"]["hash"], "sha256:n")
        self.assertEqual(cfg["approval"]["version"], 2)
        self.assertNotIn("sha256:old", read(path).decode())

    def test_header_inside_multiline_string_is_not_a_header(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        req = '\n[[requirement]]\nid = "ml"\ntext = """first line\n[approval]\nversion = 9\n"""\n'
        write(path, read(path).decode() + req)
        blueprint.write_approval(path, block())
        cfg = tomllib.loads(read(path).decode())
        self.assertEqual(cfg["approval"]["hash"], "sha256:n")
        ml = [r for r in cfg["requirement"] if r["id"] == "ml"][0]
        self.assertEqual(ml["text"], "first line\n[approval]\nversion = 9\n")

    def test_header_inside_multiline_string_with_real_approval(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        req = '\n[[requirement]]\nid = "ml"\ntext = """a\n[approval]\nb"""\n'
        old = '\n[approval]\nversion = 1\ndate = "2020-01-01"\nhash = "sha256:old"\napproved_by = "X"\n'
        write(path, read(path).decode() + req + old)
        blueprint.write_approval(path, block())
        cfg = tomllib.loads(read(path).decode())
        self.assertEqual(cfg["approval"]["hash"], "sha256:n")
        self.assertEqual([r for r in cfg["requirement"] if r["id"] == "ml"][0]["text"], "a\n[approval]\nb")

    def test_unparseable_file_refused_untouched(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        body = read(path).decode() + '\n[[requirement]]\nid = "x"\ntext = """never closed\n'
        write(path, body)
        with self.assertRaises(blueprint.BlueprintError):
            blueprint.write_approval(path, block())
        self.assertEqual(read(path).decode(), body)

    def test_result_that_does_not_round_trip_is_refused_untouched(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        body = read(path).decode() + '\n[approval]\nversion = 1\n\n[approval.extra]\nk = 1\n'
        write(path, body)
        with self.assertRaises(blueprint.BlueprintError):
            blueprint.write_approval(path, block())
        self.assertEqual(read(path).decode(), body)

    def test_other_tables_unchanged_after_write(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        before = tomllib.loads(read(path).decode())
        blueprint.write_approval(path, block())
        after = tomllib.loads(read(path).decode())
        after.pop("approval")
        self.assertEqual(after, before)


# fake token shapes, built at run time so no token-shaped literal sits in the source
GHP = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2"
XOXB = "xoxb-" + "1234567890-abcdefghijkl"


class SecretRedactionTests(Base):
    def seeded(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        text = read(path).decode().replace("Build the Worker.", f"Use {GHP}").replace("Pages are checked every morning", f"Post with {XOXB}")
        write(path, text)
        return d

    def test_lint_warn_lines_redact_extra_shapes_and_flag_secret(self):
        r = run("lint", self.seeded())
        out = r.stdout + r.stderr
        self.assertNotIn(GHP, out)
        self.assertNotIn(XOXB, out)
        self.assertIn("[redacted]", out)
        self.assertIn("secret-shaped", out)

    def test_json_and_summary_redact_extra_shapes(self):
        d = self.seeded()
        for args in (("blueprint", d, "--json"), ("blueprint", d)):
            out = run(*args).stdout
            self.assertNotIn(GHP, out, args)
            self.assertNotIn(XOXB, out, args)

    def test_desk_config_redacts_extra_shapes(self):
        html = routineos.desk_page("x", routine_dir=self.seeded())
        self.assertNotIn(GHP, html)
        self.assertNotIn(XOXB, html)

    def test_secret_warning_names_the_part_not_the_value(self):
        g = blueprint.derive(self.seeded())
        hits = [w for w in g["warnings"] if "secret-shaped" in w]
        self.assertEqual(len(hits), 2, g["warnings"])
        self.assertTrue(any("review-worker" in w for w in hits), hits)
        self.assertTrue(any("fresh" in w for w in hits), hits)
        for w in hits:
            self.assertNotIn(GHP, w)
            self.assertNotIn(XOXB, w)

    def test_no_secret_no_warning(self):
        g = blueprint.derive(self.copy())
        self.assertFalse(any("secret-shaped" in w for w in g["warnings"]), g["warnings"])


class ApproveScreenTests(Base):
    def test_screen_shows_requirement_text_and_edges_before_the_name_prompt(self):
        d = self.copy()
        code, out, err = run_tty(["blueprint", "approve", d], "\n\n")
        self.assertEqual(code, 1, out + err)
        # the prompts go to stderr here (readline, stderr not a terminal); the screen is everything written before the abort
        self.assertIn("Your name:", err)
        shown = out[:out.index("aborted")].replace("\r\n", "\n")
        self.assertIn("Pages are checked every morning", shown)
        self.assertIn("I get a report in the Desk", shown)
        g = blueprint.derive(d)
        self.assertTrue(g["edges"])
        for e in g["edges"]:
            self.assertIn(f"{e['from']} -> {e['to']} ({e['type']}", shown)
        self.assertIn("stage:write -> store:artifact-db (stores, runs)", shown)

    def test_screen_redacts_requirement_text(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        write(path, read(path).decode().replace("Pages are checked every morning", f"Use {GHP}"))
        code, out, err = run_tty(["blueprint", "approve", d], "\n\n")
        self.assertNotIn(GHP, out)
        self.assertIn("Use [redacted]", out)


class HashCoverageTests(Base):
    """The approval hash covers routine type, first_run, gate transport and edge labels."""
    TEMPLATE = os.path.join(ROOT, "templates", "inbox-triage")

    def approved(self, src):
        d = self.copy(src)
        path = os.path.join(d, "routine.toml")
        if not blueprint.has_blueprint(d):
            with open(path, "a", encoding="utf-8") as fh:
                fh.write('\n[[requirement]]\nid = "r1"\ntext = "Triage the inbox"\n')
        blueprint.write_approval(path, blueprint.approval_block(1, "2026-11-13", blueprint.derive(d)["hash"], "Ada"))
        self.assertTrue(blueprint.derive(d)["approval"]["matches"])
        return d, path

    def drifts(self, src, old, new):
        d, path = self.approved(src)
        text = read(path).decode()
        self.assertIn(old, text)
        write(path, text.replace(old, new, 1))
        g = blueprint.derive(d)
        self.assertFalse(g["approval"]["matches"], (old, new))
        self.assertTrue(any("changed since it was approved" in w for w in g["warnings"]))

    def test_first_run_change_is_drift(self):
        self.drifts(self.TEMPLATE, 'first_run = "report-only"', 'first_run = "live"')

    def test_routine_type_change_is_drift(self):
        self.drifts(self.TEMPLATE, 'type = "approval-gated"', 'type = "serverless"')

    def test_gate_transport_change_is_drift(self):
        self.drifts(self.TEMPLATE, 'transport = "email"', 'transport = "desk"')

    def test_edge_labels_are_in_the_canonical_form(self):
        g = blueprint.derive(self.copy())
        labelled = [e for e in g["edges"] if e.get("label")]
        self.assertTrue(labelled)
        before = blueprint.graph_hash(g)
        labelled[0]["label"] = labelled[0]["label"] + "-changed"
        self.assertNotEqual(blueprint.graph_hash(g), before)

    def test_state_and_needs_still_not_hashed(self):
        d, path = self.approved(os.path.join(ROOT, "tests", "fixtures", "blueprint", "authored"))
        write(path, read(path).decode().replace('needs = "Build the Worker."', 'needs = "Something else."'))
        self.assertTrue(blueprint.derive(d)["approval"]["matches"])


class TerminalEscapeTests(Base):
    """Text shown on a terminal cannot carry escapes or bidi controls that change what the person sees."""
    def seeded(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        evil = "Pages\\u001b[2J are \\u202Echecked\\u0007 \\u009b1m"
        write(path, read(path).decode().replace("Pages are checked every morning", evil)
              .replace('needs = "Build the Worker."', 'needs = "Build\\u001b]0;x\\u0007 \\u2066it"'))
        return d

    def assert_clean(self, text):
        for ch in ("\x1b", "\u202e", "\x07", "\x9b", "\u2066"):
            self.assertNotIn(ch, text)

    def test_approve_screen_escapes_controls_and_bidi(self):
        code, out, err = run_tty(["blueprint", "approve", self.seeded()], "\n\n")
        self.assert_clean(out)
        self.assertIn("Pages\\x1b[2J are \\u202echecked\\x07 \\x9b1m", out)

    def test_summary_permissions_and_lint_escape(self):
        d = self.seeded()
        for args in (("blueprint", d), ("permissions", d), ("lint", d)):
            r = run(*args)
            self.assert_clean(r.stdout)
        self.assertIn("Build\\x1b]0;x\\x07 \\u2066it", run("lint", d).stdout)

    def test_terminal_safe_keeps_newlines_and_plain_text(self):
        self.assertEqual(blueprint.terminal_safe("a\nb\tc\u00e9\u202e"), "a\nb\\x09c\u00e9\\u202e")


if __name__ == "__main__":
    unittest.main()
