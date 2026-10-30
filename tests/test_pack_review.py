"""Refusals found in the adversarial review of the pack format."""
import json
import os
import subprocess
import sys
import tempfile
import time
import tomllib
import unittest

from pack_fixtures import CLI, gated_pack, minimal_pack

import pack


def has(problems, text):
    return any(text in p for p in problems)


class ReviewRefusalTests(unittest.TestCase):
    def assertRefused(self, p, text):
        problems = pack.validate(p)
        self.assertTrue(has(problems, text), f"expected {text!r} in {problems}")

    def test_a_trailing_newline_never_passes_a_pattern(self):
        p = minimal_pack()
        p["id"] = p["routine"]["routine"]["name"] = "demo-watch\n"
        self.assertRefused(p, "id must be")
        p = minimal_pack()
        p["files"] = {"lib/a.py\n": "x = 1\n"}
        self.assertRefused(p, "path is not allowed")
        p = minimal_pack()
        p["stages"][0]["id"] = "read\n"
        p["connectors"][0]["stages"] = ["read\n"]
        self.assertRefused(p, "stages[0].id must be")
        p = minimal_pack()
        p["stages"][1]["writes"] = ["runs\n"]
        self.assertRefused(p, "not a store collection name")
        p = minimal_pack()
        p["version"] = "1.0.0\n"
        self.assertRefused(p, "MAJOR.MINOR.PATCH")

    def test_unpaired_surrogate_is_refused(self):
        p = minimal_pack()
        p["prompt"] += "\ud800\n"
        self.assertRefused(p, "unpaired surrogate")

    def test_paths_that_differ_only_by_case_are_refused(self):
        p = gated_pack()
        p["files"]["skills/reply-style/skill.md"] = "---\nname: other\n---\n"
        self.assertRefused(p, "only by letter case")

    def test_a_dot_segment_cannot_shadow_another_file(self):
        p = gated_pack()
        p["files"]["skills/reply-style/./SKILL.md"] = "---\nname: other\n---\n"
        self.assertRefused(p, "path is not allowed")

    def test_command_runs_the_named_script_with_no_interpreter_options(self):
        for cmd in ("python3 -mpip lib/count.py", "python3 -c lib/count.py", "python3 -I lib/count.py"):
            p = gated_pack()
            p["stages"][3]["command"] = cmd
            self.assertRefused(p, "command must name")

    def test_connector_stages_and_alternatives_match_the_schema(self):
        p = gated_pack()
        del p["connectors"][1]["stages"]
        p["stages"][4]["connectors"] = []
        self.assertRefused(p, "connectors[1].stages")
        for alt in ("", " ", "x" * 81):
            p = gated_pack()
            p["connectors"][1]["alternatives"] = [alt]
            self.assertRefused(p, "alternatives")


class ReviewParseTests(unittest.TestCase):
    def test_deep_nesting_is_a_clean_refusal(self):
        for n in (100, 5000, 200000):
            raw = ('{"x":' + "[" * n + "]" * n + "}").encode()
            with self.assertRaises(pack.PackError) as ctx:
                pack.validate(pack.parse(raw))
            self.assertIn("nested", str(ctx.exception))

    def test_scan_of_a_long_word_is_linear(self):
        # The email pattern used to retry from every character: minutes for a 512 KiB pack.
        p = minimal_pack()
        p["readme"] = "a" * 400000
        start = time.monotonic()
        self.assertEqual(pack.validate(p), [])
        self.assertLess(time.monotonic() - start, 10)

    def test_duplicate_key_message_carries_no_control_character_or_secret(self):
        secret = "sk-" + "a1B2" * 6
        for key in ("a\x1b[31m", secret):
            raw = json.dumps({key: 1}).encode()[:-1] + b"," + json.dumps(key).encode() + b": 2}"
            with self.assertRaises(pack.PackError) as ctx:
                pack.parse(raw)
            self.assertIn("duplicate key", str(ctx.exception))
            self.assertNotIn("\x1b", str(ctx.exception))
            self.assertNotIn(secret, str(ctx.exception))


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# What `routineos.py write` writes (desk_contract.py): runs/, entities/, inbox/, pending/, views/, columns/.
WRITE_CONTRACT = {"runs", "entities", "inbox", "pending", "views", "columns"}


class ReviewSchemaTests(unittest.TestCase):
    def test_file_path_pattern_in_the_schema_is_the_code_pattern(self):
        import jsonschema_subset
        with open(os.path.join(ROOT, "catalog", "schema", "pack.v1.schema.json"), encoding="utf-8") as fh:
            schema = json.load(fh)
        pattern = schema["properties"]["files"]["propertyNames"]["pattern"]
        self.assertEqual(pattern[:-1] + "\\Z", pack.FILE_RE.pattern)
        for path in ("lib/x/../a.py", "lib/x/./a.py", "lib/a.py", "skills/x/SKILL.md", "lib/My.py"):
            p = minimal_pack()
            p["files"] = {path: "x = 1\n"}
            self.assertEqual(bool(jsonschema_subset.validate(p, schema)), bool(pack.validate(p)), path)


class ReviewTemplateTests(unittest.TestCase):
    def test_write_stage_names_the_collections_the_write_contract_writes(self):
        for d in sorted(os.listdir(os.path.join(ROOT, "templates"))):
            path = os.path.join(ROOT, "templates", d, "pack.json")
            if not os.path.exists(path):
                continue
            with open(path, encoding="utf-8") as fh:
                p = json.load(fh)
            for s in p["stages"]:
                if "routineos.py write" in s.get("command", ""):
                    writes = set(s.get("writes", []))
                    self.assertLessEqual(writes, WRITE_CONTRACT, d)
                    self.assertLessEqual({"runs", "entities", "inbox"}, writes, d)
                    gated = any(x["kind"] == "gate" for x in p["stages"])
                    self.assertEqual("pending" in writes, gated, d)


class ReviewWriteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_toml_emitter_writes_text_beyond_the_basic_plane_and_del(self):
        r = {"routine": {"name": "x", "type": "watch", "schedule": "0 1 * * *"},
             "setting": [{"name": "q", "type": "list", "label": "Sources \U0001d400 a\x7fb", "default": []}]}
        self.assertEqual(tomllib.loads(pack.toml_dumps(r)), r)

    def test_install_of_text_beyond_the_basic_plane_lints(self):
        p = minimal_pack()
        p["routine"]["setting"][0]["label"] = "Sources \U0001d400"
        self.assertEqual(pack.validate(p), [])
        src = os.path.join(self.d, "p.json")
        with open(src, "w", encoding="utf-8") as fh:
            fh.write(pack.dumps(p))
        res = subprocess.run([sys.executable, CLI, "pack", "install", src, "--dir", os.path.join(self.d, "out")],
                             capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_export_refuses_a_pack_over_the_size_cap(self):
        p = minimal_pack()
        p["files"] = {"lib/big.txt": "x" * (pack.MAX_PACK_BYTES + 1)}
        out = os.path.join(self.d, "r")
        pack.install(p, out, desk_html=lambda name: "<html></html>\n")
        with self.assertRaises(pack.PackError) as ctx:
            pack.export(out)
        self.assertTrue(has(ctx.exception.problems, "byte limit"), ctx.exception.problems)


if __name__ == "__main__":
    unittest.main()
