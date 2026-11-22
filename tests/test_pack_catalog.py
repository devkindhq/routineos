"""The template catalog, its index, the list command and the JSON Schemas."""
import copy
import glob
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest

from pack_fixtures import CATALOG, CLI, ROOT, gated_pack, minimal_pack

import jsonschema_subset
import pack
import routineos

SCHEMA_DIR = os.path.join(CATALOG, "schema")


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def run(*args, cwd=None):
    return subprocess.run([sys.executable, CLI, *args], capture_output=True, text=True, cwd=cwd)


def entry(**over):
    e = {"id": "demo-watch", "version": "1.0.0", "title": "Demo watch", "summary": "Watches two pages.",
         "category": "general", "maturity": "unpiloted", "type": "watch", "schedule": "0 22 * * 1",
         "path": "demo-watch.json", "bytes": 10, "sha256": "a" * 64,
         "connectors": [{"id": "web", "label": "Web fetch", "required": True}],
         "inspiration": []}
    e.update(over)
    return e


class BuildCatalogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.templates = os.path.join(self.tmp.name, "templates")
        self.out = os.path.join(self.tmp.name, "catalog")
        os.makedirs(self.templates)
        for p in (minimal_pack(), gated_pack()):
            p = pack.renamed(p, "gated-watch") if p.get("files") else p
            pack.install(p, os.path.join(self.templates, p["id"]), desk_html=routineos.desk_page)
        os.makedirs(os.path.join(self.templates, "no-pack-yet"))

    def tearDown(self):
        self.tmp.cleanup()

    def test_writes_each_pack_and_a_sorted_index(self):
        changed = pack.build_catalog(self.templates, self.out)
        self.assertEqual(sorted(changed), ["demo-watch.json", "gated-watch.json", "index.json"])
        idx = load_json(os.path.join(self.out, "index.json"))
        self.assertEqual(idx["format"], pack.CATALOG_FORMAT)
        self.assertEqual([e["id"] for e in idx["templates"]], ["demo-watch", "gated-watch"])
        self.assertEqual(pack.validate_index(idx), [])
        for e in idx["templates"]:
            with open(os.path.join(self.out, e["path"]), "rb") as fh:
                raw = fh.read()
            self.assertEqual(e["bytes"], len(raw))
            self.assertEqual(e["sha256"], hashlib.sha256(raw).hexdigest())
            self.assertEqual(pack.validate(pack.parse(raw)), [])
        gated = idx["templates"][1]
        self.assertEqual(gated["connectors"], [{"id": "web", "label": "Web fetch", "required": True},
                                              {"id": "mail", "label": "Mail", "required": False}])
        self.assertEqual(gated["type"], "watch")

    def test_second_run_and_check_change_nothing(self):
        pack.build_catalog(self.templates, self.out)
        self.assertEqual(pack.build_catalog(self.templates, self.out), [])
        self.assertEqual(pack.build_catalog(self.templates, self.out, check=True), [])

    def test_check_reports_a_change_and_writes_nothing(self):
        pack.build_catalog(self.templates, self.out)
        before = load_json(os.path.join(self.out, "demo-watch.json"))
        with open(os.path.join(self.templates, "demo-watch", "prompt.md"), "a", encoding="utf-8") as fh:
            fh.write("One more line.\n")
        self.assertEqual(sorted(pack.build_catalog(self.templates, self.out, check=True)),
                         ["demo-watch.json", "index.json"])
        self.assertEqual(load_json(os.path.join(self.out, "demo-watch.json")), before)

    def test_stale_pack_files_are_removed(self):
        pack.build_catalog(self.templates, self.out)
        with open(os.path.join(self.out, "gone.json"), "w") as fh:
            fh.write("{}\n")
        self.assertEqual(pack.build_catalog(self.templates, self.out, check=True), ["gone.json"])
        self.assertTrue(os.path.exists(os.path.join(self.out, "gone.json")))
        self.assertEqual(pack.build_catalog(self.templates, self.out), ["gone.json"])
        self.assertFalse(os.path.exists(os.path.join(self.out, "gone.json")))

    def test_an_invalid_template_stops_the_build_and_writes_nothing(self):
        with open(os.path.join(self.templates, "demo-watch", "prompt.md"), "w", encoding="utf-8") as fh:
            fh.write("# No clause\n")
        with self.assertRaises(pack.PackError) as cm:
            pack.build_catalog(self.templates, self.out)
        self.assertTrue(any(x.startswith("demo-watch: ") for x in cm.exception.problems), cm.exception.problems)
        self.assertFalse(os.path.exists(self.out))

    def test_folder_name_must_equal_the_pack_id(self):
        os.rename(os.path.join(self.templates, "demo-watch"), os.path.join(self.templates, "other-name"))
        with self.assertRaises(pack.PackError) as cm:
            pack.build_catalog(self.templates, self.out)
        self.assertIn("other-name", str(cm.exception))


class IndexTests(unittest.TestCase):
    def index(self, *entries):
        return {"format": pack.CATALOG_FORMAT, "templates": list(entries) or [entry()]}

    def test_a_good_index_passes(self):
        self.assertEqual(pack.validate_index(self.index()), [])

    def test_refusals(self):
        cases = (
            (lambda i: i.update(extra=1), "unknown key 'extra'"),
            (lambda i: i.update(format="x"), "format"),
            (lambda i: i["templates"][0].update(path="../x.json"), "path"),
            (lambda i: i["templates"][0].update(path="https://evil.example/x.json"), "path"),
            (lambda i: i["templates"][0].update(sha256="xyz"), "sha256"),
            (lambda i: i["templates"][0].update(bytes=-1), "bytes"),
            (lambda i: i["templates"][0].update(bytes=True), "bytes"),
            (lambda i: i["templates"][0].update(maturity="beta"), "maturity"),
            (lambda i: i["templates"][0].update(title="Demo\x1b[2J"), "control character"),
            (lambda i: i["templates"][0]["connectors"][0].update(required="yes"), "required"),
            (lambda i: i["templates"][0].update(inspiration=["http://n8n.io/x"]), "inspiration"),
            (lambda i: i["templates"].append(entry()), "duplicate"),
            (lambda i: i["templates"].insert(0, entry(id="zz-last", path="zz-last.json")), "sorted"),
        )
        for mutate, word in cases:
            idx = self.index()
            mutate(idx)
            problems = pack.validate_index(idx)
            self.assertTrue(any(word in x for x in problems), (word, problems))
            for line in problems:
                self.assertNotIn("\x1b", line)

    def test_load_index_caps_and_validates(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "index.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(self.index(), fh)
            self.assertEqual(pack.load_index(path)["templates"][0]["id"], "demo-watch")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"format": "nope", "templates": []}, fh)
            with self.assertRaises(pack.PackError) as cm:
                pack.load_index(path)
            self.assertFalse(cm.exception.io)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(" " * (pack.MAX_INDEX_BYTES + 1))
            with self.assertRaises(pack.PackError) as cm:
                pack.load_index(path)
            self.assertTrue(cm.exception.io)

    def test_cli_list_prints_each_entry(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "index.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(self.index(entry(), entry(id="other-watch", path="other-watch.json", title="Other")), fh)
            res = run("pack", "list", path)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertIn("demo-watch", res.stdout)
            self.assertIn("other-watch", res.stdout)
            self.assertIn("Web fetch (required)", res.stdout)
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"format": "nope"}, fh)
            self.assertEqual(run("pack", "list", path).returncode, 1)
            self.assertEqual(run("pack", "list", os.path.join(d, "missing.json")).returncode, 2)


class SchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack_schema = load_json(os.path.join(SCHEMA_DIR, "pack.v1.schema.json"))
        cls.catalog_schema = load_json(os.path.join(SCHEMA_DIR, "catalog.v1.schema.json"))

    def test_schema_keys_match_the_code(self):
        s = self.pack_schema
        self.assertEqual(set(s["properties"]), set(pack.PACK_KEYS))
        self.assertEqual(set(s["required"]), set(pack.REQUIRED_KEYS))
        defs = s["$defs"]
        self.assertEqual(set(defs["stage"]["properties"]), set(pack.STAGE_KEYS))
        self.assertEqual(set(defs["connector"]["properties"]), set(pack.CONNECTOR_KEYS))
        self.assertEqual(set(defs["inspiration"]["properties"]), set(pack.INSPIRATION_KEYS))
        self.assertEqual(set(defs["definition"]["properties"]), set(pack.DEFINITION_KEYS))
        self.assertEqual(set(defs["type"]["properties"]), set(pack.TYPE_KEYS))
        self.assertEqual(set(defs["view"]["properties"]), set(pack.VIEW_KEYS))
        self.assertEqual(set(defs["routine"]["properties"]), set(pack.ROUTINE_TABLES))
        self.assertEqual(set(defs["blueprint"]["properties"]), set(pack.BLUEPRINT_KEYS))
        self.assertEqual(set(defs["requirement"]["properties"]), set(pack.REQUIREMENT_KEYS))
        self.assertEqual(set(defs["infra"]["properties"]), set(pack.INFRA_KEYS))
        self.assertEqual(set(defs["part_state"]["properties"]), set(pack.PART_STATE_KEYS))
        for table, keys in pack.ROUTINE_TABLES.items():
            node = defs["routine"]["properties"][table]
            node = node.get("items", node)
            node = defs[node["$ref"].split("/")[-1]] if "$ref" in node else node
            self.assertEqual(set(node["properties"]), set(keys), table)
        c = self.catalog_schema
        self.assertEqual(set(c["properties"]), set(pack.INDEX_KEYS))
        self.assertEqual(set(c["$defs"]["entry"]["properties"]), set(pack.ENTRY_KEYS))
        self.assertEqual(set(c["$defs"]["entry"]["properties"]["connectors"]["items"]["properties"]),
                         set(pack.ENTRY_CONNECTOR_KEYS))
        self.assertEqual(c["properties"]["format"]["const"], pack.CATALOG_FORMAT)
        self.assertEqual(s["properties"]["format"]["const"], pack.FORMAT)

    def test_fixture_packs_match_the_schema(self):
        for p in (minimal_pack(), gated_pack()):
            self.assertEqual(jsonschema_subset.validate(p, self.pack_schema), [])

    def test_the_subset_validator_checks_something(self):
        p = minimal_pack()
        p["extra"] = 1
        self.assertTrue(any("extra" in x for x in jsonschema_subset.validate(p, self.pack_schema)))
        p = minimal_pack()
        p["stages"][0]["kind"] = "shell"
        self.assertTrue(jsonschema_subset.validate(p, self.pack_schema))
        p = minimal_pack()
        p["routine"]["workspace"]["name"] = "</script>"
        self.assertTrue(jsonschema_subset.validate(p, self.pack_schema))
        idx = {"format": pack.CATALOG_FORMAT, "templates": [entry(extra=1)]}
        self.assertTrue(jsonschema_subset.validate(idx, self.catalog_schema))
        self.assertEqual(jsonschema_subset.validate({"format": pack.CATALOG_FORMAT, "templates": [entry()]},
                                                    self.catalog_schema), [])


    def _pack(self, mutate):
        p = minimal_pack()
        mutate(p["definition"])
        return p

    def _schema_errors(self, p):
        return jsonschema_subset.validate(p, self.pack_schema)

    def test_schema_type_accepts_shared(self):
        p = self._pack(lambda d: d["types"]["item"].update(shared=True))
        self.assertEqual(self._schema_errors(p), [])

    def test_schema_type_and_desk_accept_triage_and_hide_lists(self):
        p = self._pack(lambda d: (d["types"]["item"].update(triage=True), d.update(desk={"hideLists": ["item"]})))
        self.assertEqual(self._schema_errors(p), [])
        self.assertEqual(pack.validate(p), [])
        bad = self._pack(lambda d: d["types"]["item"].update(triage="yes"))
        self.assertTrue(self._schema_errors(bad))
        self.assertTrue(pack.validate(bad))
        bad = self._pack(lambda d: d.update(desk={"hideLists": ["nope"]}))
        self.assertTrue(pack.validate(bad))

    def test_schema_accepts_a_routine_desk_table(self):
        good = {"timezone": "Australia/Melbourne", "link": [{"label": "Tracker", "url": "https://example.org/a", "icon": "globe"}]}
        p = self._pack(lambda d: None)
        p["routine"]["desk"] = good
        self.assertEqual(self._schema_errors(p), [])
        for bad in ({"pages": True}, {"link": [{"label": "x", "url": "http://example.org"}]},
                    {"link": [{"label": "x", "url": "https://example.org", "icon": "rocket"}]}):
            q = self._pack(lambda d: None)
            q["routine"]["desk"] = bad
            self.assertTrue(self._schema_errors(q), bad)

    def test_schema_type_rejects_unknown_key(self):
        p = self._pack(lambda d: d["types"]["item"].update(bogus=True))
        self.assertTrue(self._schema_errors(p))
        self.assertTrue(pack.validate(p))

    def test_pack_export_accepts_shared_type(self):
        p = self._pack(lambda d: d["types"]["item"].update(shared=True))
        self.assertEqual(pack.validate(p), [])

    def test_schema_signals_include_people_drop(self):
        p = self._pack(lambda d: d["learning"].update(signals={"people_drop": False}))
        self.assertEqual(self._schema_errors(p), [])

    def test_schema_desk_accepts_health_record_start(self):
        for desk in ({"health": {"item": {"field": "url", "green": ["ok"]}}},
                     {"record": {"strip": {"item": [{"chip": "state"}]}}},
                     {"start": "today"}):
            p = self._pack(lambda d: d.update(desk=desk))
            self.assertEqual(self._schema_errors(p), [], desk)

    def test_schema_desk_rejects_unknown_key(self):
        p = self._pack(lambda d: d.update(desk={"bogus": 1}))
        self.assertTrue(self._schema_errors(p))
        self.assertTrue(pack.validate(p))

    def test_schema_and_pack_validate_agree(self):
        cases = {
            "shared type": lambda d: d["types"]["item"].update(shared=True),
            "unknown type key": lambda d: d["types"]["item"].update(bogus=True),
            "people_drop": lambda d: d["learning"].update(signals={"people_drop": False}),
            "unknown signal": lambda d: d["learning"].update(signals={"bogus": False}),
            "desk health": lambda d: d.update(desk={"health": {"item": {"field": "url", "green": ["ok"]}}}),
            "desk record": lambda d: d.update(desk={"record": {"strip": {"item": [{"chip": "state"}]}}}),
            "desk start": lambda d: d.update(desk={"start": "today"}),
            "desk unknown key": lambda d: d.update(desk={"bogus": 1}),
            "triage type": lambda d: d["types"]["item"].update(triage=True),
            "triage not a bool": lambda d: d["types"]["item"].update(triage="yes"),
            "desk hideLists": lambda d: d.update(desk={"hideLists": ["item"]}),
            "desk hideLists not a list": lambda d: d.update(desk={"hideLists": "item"}),
        }
        for name, mutate in cases.items():
            p = self._pack(mutate)
            cli_ok = pack.validate(p) == []
            schema_ok = self._schema_errors(p) == []
            self.assertEqual(cli_ok, schema_ok, f"{name}: pack validate {cli_ok}, schema {schema_ok}")


class CommittedCatalogTests(unittest.TestCase):
    """The catalog in catalog/ is generated, current, and valid."""

    def test_catalog_check_passes_on_the_tree(self):
        res = run("pack", "catalog", "--check")
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_readme_template_list_matches_the_catalog(self):
        with open(os.path.join(ROOT, "README.md"), encoding="utf-8") as fh:
            section = fh.read().split("\n## Templates\n", 1)[1].split("\n## ", 1)[0]
        listed = [line[2:].split(":", 1)[0] for line in section.splitlines() if line.startswith("- ")]
        index = load_json(os.path.join(CATALOG, "index.json"))
        self.assertEqual(listed, [t["id"] for t in index["templates"]])

    def test_every_catalog_file_validates(self):
        pack_schema = load_json(os.path.join(SCHEMA_DIR, "pack.v1.schema.json"))
        catalog_schema = load_json(os.path.join(SCHEMA_DIR, "catalog.v1.schema.json"))
        idx = load_json(os.path.join(CATALOG, "index.json"))
        self.assertEqual(pack.validate_index(idx), [])
        self.assertEqual(jsonschema_subset.validate(idx, catalog_schema), [])
        listed = set()
        for e in idx["templates"]:
            path = os.path.join(CATALOG, e["path"])
            with open(path, "rb") as fh:
                raw = fh.read()
            self.assertEqual(e["bytes"], len(raw), e["id"])
            self.assertEqual(e["sha256"], hashlib.sha256(raw).hexdigest(), e["id"])
            p = pack.parse(raw)
            self.assertEqual(pack.validate(p), [], e["id"])
            self.assertEqual(jsonschema_subset.validate(p, pack_schema), [], e["id"])
            listed.add(e["path"])
        res = run("pack", "list", os.path.join(CATALOG, "index.json"))
        self.assertEqual(res.returncode, 0, res.stderr)
        for e in idx["templates"]:
            self.assertIn(e["id"], res.stdout)
        on_disk = {os.path.basename(x) for x in glob.glob(os.path.join(CATALOG, "*.json"))} - {"index.json"}
        self.assertEqual(on_disk, listed)


if __name__ == "__main__":
    unittest.main()
