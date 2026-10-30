"""Pack validation, parsing and the TOML emitter."""
import json
import os
import tomllib
import unittest

from pack_fixtures import TEMPLATES, gated_pack, minimal_pack

import pack

# Built in pieces so the repo scans never see a whole secret, address or id.
FAKE_SECRET = "sk-" + "a1B2" * 6
FAKE_EMAIL = "someone" + "@" + "example.org"
FAKE_SLACK = "U" + "0123ABCDE"


def problems_of(p):
    return pack.validate(p)


class CoreTests(unittest.TestCase):
    def test_minimal_pack_is_valid(self):
        self.assertEqual(problems_of(minimal_pack()), [])

    def test_gated_pack_is_valid(self):
        self.assertEqual(problems_of(gated_pack()), [])

    def test_toml_round_trips_the_jobs_watch_routine(self):
        with open(os.path.join(TEMPLATES, "jobs-watch", "routine.toml"), "rb") as fh:
            r = tomllib.load(fh)
        self.assertEqual(tomllib.loads(pack.toml_dumps(r)), r)

    def test_toml_round_trips_awkward_strings_and_floats(self):
        r = {"routine": {"name": "x", "type": "watch", "schedule": "0 1 * * *"},
             "setting": [{"name": "q", "type": "list", "label": 'He said "hi"\\ é\n', "default": [1.5, 2, "a"]}]}
        self.assertEqual(tomllib.loads(pack.toml_dumps(r)), r)

    def test_toml_refuses_nested_tables(self):
        with self.assertRaises(pack.PackError):
            pack.toml_dumps({"routine": {"name": "x", "deep": {"a": 1}}})

    def test_parse_refuses_oversize(self):
        raw = b" " * pack.MAX_PACK_BYTES + b"{}"
        with self.assertRaises(pack.PackError) as cm:
            pack.parse(raw)
        self.assertIn("over", str(cm.exception))

    def test_parse_refuses_duplicate_keys(self):
        with self.assertRaises(pack.PackError) as cm:
            pack.parse(b'{"a": {"b": 1, "b": 2}}')
        self.assertIn("duplicate", str(cm.exception))

    def test_parse_refuses_non_object_and_bad_utf8(self):
        for raw in (b"[1, 2]", b"\xff\xfe{}", b"{not json", b'{"a": NaN}'):
            with self.assertRaises(pack.PackError, msg=raw):
                pack.parse(raw)

    def test_parse_reads_a_valid_pack(self):
        p = minimal_pack()
        self.assertEqual(pack.parse(json.dumps(p).encode("utf-8")), p)

    def test_meta_keys_leave_out_the_body(self):
        for key in ("routine", "prompt", "readme", "definition", "files"):
            self.assertNotIn(key, pack.META_KEYS)
        self.assertEqual(pack.PACK_KEYS[0], "$schema")


def has(problems, text):
    return any(text in p for p in problems)


class RefusalTests(unittest.TestCase):
    def assertRefused(self, p, text):
        problems = problems_of(p)
        self.assertTrue(has(problems, text), f"expected {text!r} in {problems}")
        return problems

    def test_unknown_keys_at_every_level(self):
        for mutate, where in (
            (lambda p: p.update(scripts="x"), "scripts"),
            (lambda p: p["routine"]["setting"][0].update(hook="x"), "hook"),
            (lambda p: p["routine"].update(run={"a": 1}), "run"),
            (lambda p: p["stages"][0].update(shell="x"), "shell"),
            (lambda p: p["connectors"][0].update(token="x"), "token"),
            (lambda p: p["definition"]["types"]["item"].update(script="x"), "script"),
            (lambda p: p["definition"]["types"]["item"]["fields"]["url"].update(js="x"), "js"),
            (lambda p: p["definition"].update(page="x"), "page"),
        ):
            p = minimal_pack()
            mutate(p)
            self.assertRefused(p, f"unknown key '{where}'")

    def test_format_and_meta_formats(self):
        for key, value, text in (("format", "routineos.pack.v2", "format"), ("version", "1.0", "version"),
                                 ("category", "crypto", "category"), ("maturity", "beta", "maturity"),
                                 ("title", "x" * 81, "title"), ("summary", "", "summary"), ("id", "Bad_Id", "id")):
            p = minimal_pack()
            p[key] = value
            self.assertRefused(p, text)

    def test_missing_required_key(self):
        p = minimal_pack()
        del p["stages"]
        self.assertRefused(p, "missing key 'stages'")

    def test_inspiration_must_be_https(self):
        p = minimal_pack()
        p["inspiration"] = [{"source": "n8n", "title": "x", "url": "http://n8n.io/workflows/1"}]
        self.assertRefused(p, "https")

    def test_first_run_live_is_refused(self):
        p = minimal_pack()
        p["routine"]["routine"]["first_run"] = "live"
        self.assertRefused(p, "report-only")

    def test_routine_lint_problems_surface(self):
        p = minimal_pack()
        p["prompt"] = "# Demo\n"
        self.assertRefused(p, "untrusted-data clause")
        p = minimal_pack()
        p["routine"]["routine"]["schedule"] = "*/5 * * * *"
        self.assertRefused(p, "schedule")
        p = minimal_pack()
        p["routine"]["routine"]["type"] = "daemon"
        self.assertRefused(p, "routine type")

    def test_send_action_needs_a_gate(self):
        p = minimal_pack()
        p["routine"]["action"] = [{"name": "send-reply", "kind": "send"}]
        self.assertRefused(p, "gate required")

    def test_never_learnable_binding_is_refused(self):
        p = minimal_pack()
        p["routine"]["setting"].append({"name": "push_rule", "type": "list", "role": "include", "default": []})
        item = p["definition"]["types"]["item"]
        item["fields"]["kind"] = {"label": "Kind", "type": "text"}
        item["settingFilters"] = [{"setting": "push_rule", "field": "kind"}]
        self.assertRefused(p, "never learnable")

    def test_inbox_needs_the_cap_setting(self):
        p = minimal_pack()
        p["routine"]["setting"] = p["routine"]["setting"][:1]
        self.assertRefused(p, "max_inbox_per_run")

    def test_definition_matches_the_workspace_switch(self):
        p = minimal_pack()
        del p["definition"]
        self.assertRefused(p, "definition")
        p = minimal_pack()
        p["routine"]["workspace"]["enabled"] = False
        self.assertRefused(p, "definition")

    def test_id_equals_the_routine_name(self):
        p = minimal_pack()
        p["id"] = "other-watch"
        self.assertRefused(p, "routine.name")

    def test_stages_never_touch_people_collections(self):
        for coll in ("settings", "settings/demo", "data/users", "decisions/x", "userstate", "merges"):
            for key in ("writes", "reads"):
                p = minimal_pack()
                p["stages"][1][key] = [coll]
                self.assertRefused(p, "people collection")

    def test_file_paths_are_confined(self):
        for path in ("lib/../x.py", "/abs.py", "lib/x.sh", "README.md", "lib\\x.py", "dashboard/index.html",
                     "skills/a/../../x.md", "lib/con.py"):
            p = minimal_pack()
            p["files"] = {path: "x = 1\n"}
            self.assertRefused(p, "files")

    def test_secret_is_reported_by_path_never_by_value(self):
        p = minimal_pack()
        p["prompt"] += f"Use key {FAKE_SECRET}\n"
        problems = self.assertRefused(p, "prompt")
        self.assertTrue(has(problems, "secret"))
        for line in problems:
            self.assertNotIn(FAKE_SECRET, line)

    def test_secret_in_a_setting_default_is_not_echoed(self):
        p = minimal_pack()
        p["routine"]["setting"].append({"name": "mode", "type": "choice", "choices": ["a"], "default": FAKE_SECRET})
        for line in problems_of(p):
            self.assertNotIn(FAKE_SECRET, line)

    def test_email_and_slack_id_are_refused(self):
        p = minimal_pack()
        p["readme"] += f"Write to {FAKE_EMAIL}\n"
        problems = self.assertRefused(p, "readme")
        self.assertTrue(has(problems, "email"))
        self.assertFalse(has(problems, FAKE_EMAIL))
        p = minimal_pack()
        p["connectors"][0]["connect"] = f"Post to {FAKE_SLACK}"
        problems = self.assertRefused(p, "connectors[0].connect")
        self.assertFalse(has(problems, FAKE_SLACK))

    def test_recipient_settings_default_empty(self):
        for name in ("approvers", "recipient_list", "cc", "notify_channel", "phone"):
            p = minimal_pack()
            p["routine"]["setting"].append({"name": name, "type": "list", "default": ["someone"]})
            self.assertRefused(p, "empty")
        p = minimal_pack()
        p["routine"]["setting"].append({"name": "approvers", "type": "list", "default": []})
        self.assertEqual(problems_of(p), [])

    def test_write_connector_needs_a_gate(self):
        p = minimal_pack()
        p["connectors"][0]["access"] = "write"
        self.assertRefused(p, "gate")

    def test_required_connector_must_be_used(self):
        p = minimal_pack()
        p["connectors"][0]["stages"] = []
        p["stages"][0]["connectors"] = []
        self.assertRefused(p, "no stage uses it")

    def test_stage_and_connector_references_agree(self):
        p = minimal_pack()
        p["stages"][0]["connectors"] = ["web", "crm"]
        self.assertRefused(p, "undeclared connector 'crm'")
        p = minimal_pack()
        p["stages"][1]["connectors"] = ["web"]
        self.assertRefused(p, "does not list")
        p = minimal_pack()
        p["connectors"][0]["stages"] = ["read", "nowhere"]
        self.assertRefused(p, "unknown stage 'nowhere'")

    def test_code_stage_commands(self):
        for cmd, text in (("bash x.sh", "python3"), ("python3 lib/missing.py", "lib/missing.py"),
                          (WRITE_CMD_WITH_PIPE, "single"), ("python3 /usr/bin/x.py", "name"),
                          ("python3 skills/routineos/scripts/routineos.py write\nrm -rf x", "single")):
            p = minimal_pack()
            p["stages"][1]["command"] = cmd
            self.assertRefused(p, text)
        p = minimal_pack()
        del p["stages"][1]["command"]
        self.assertRefused(p, "command")

    def test_skill_stage_needs_its_skill_file(self):
        p = gated_pack()
        del p["files"]["skills/reply-style/SKILL.md"]
        self.assertRefused(p, "skills/reply-style/SKILL.md")
        p = gated_pack()
        p["files"]["skills/reply-style/SKILL.md"] = "---\nname: other\n---\n"
        self.assertRefused(p, "frontmatter")

    def test_gate_stage_needs_the_gate_on(self):
        p = gated_pack()
        p["routine"]["gate"]["enabled"] = False
        del p["routine"]["action"]
        p["connectors"][1]["access"] = "read"
        self.assertRefused(p, "gate stage")

    def test_workspace_name_cannot_break_out_of_the_desk_page(self):
        for key, value in (("name", "</script><script>alert(1)</script>"), ("template", "<b>x</b>"),
                           ("template_version", "1<"), ("template_version", 0)):
            p = minimal_pack()
            p["routine"]["workspace"][key] = value
            self.assertRefused(p, f"workspace.{key}")

    def test_control_characters_are_refused(self):
        for mutate, where in (
            (lambda p: p["connectors"][0].update(purpose="Opens \x1b[2J pages."), "connectors[0].purpose"),
            (lambda p: p["connectors"][0].update(label="Web\x9b"), "connectors[0].label"),
            (lambda p: p.update(readme="# Demo\r\n"), "readme"),
            (lambda p: p["definition"]["types"]["item"]["fields"].update({"u\x07": {"type": "text"}}), "key"),
        ):
            p = minimal_pack()
            mutate(p)
            problems = self.assertRefused(p, "control character")
            self.assertTrue(has(problems, where), problems)
            for line in problems:
                self.assertFalse(any(c in line for c in "\x1b\x9b\x07\r"), line)
        p = minimal_pack()
        p["prompt"] += "line two\n"
        self.assertEqual(problems_of(p), [])

    def test_stage_ids_unique_and_counted(self):
        p = minimal_pack()
        p["stages"][1]["id"] = "read"
        self.assertRefused(p, "duplicate stage id")
        p = minimal_pack()
        p["stages"] = []
        self.assertRefused(p, "stages")


WRITE_CMD_WITH_PIPE = "python3 skills/routineos/scripts/routineos.py write | sh"


if __name__ == "__main__":
    unittest.main()
