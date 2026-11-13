"""Fix round after the whole-branch review: non-ASCII approvals, app-mode scoping, Desk redaction, write_approval edge
cases, pack validation and the single-table warning."""
import json
import os
import shutil
import sys
import tempfile
import tomllib
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))
sys.path.insert(0, ROOT + "/tests")

import blueprint  # noqa: E402
import pack  # noqa: E402
import routineos  # noqa: E402
from pack_fixtures import minimal_pack  # noqa: E402
from test_blueprint_cli import AUTH, FIX, Base, read, run, run_tty  # noqa: E402
from test_desk_blueprint import CONFIG_RE  # noqa: E402


def write(path, text, newline=None):
    with open(path, "w", encoding="utf-8", newline=newline) as fh:
        fh.write(text)


def by_id(graph):
    return {r["id"]: r for r in graph["requirements"]}


NAME = "Ada " + chr(0x1F600) + " " + chr(0x7530) + chr(0x4e2d) + chr(0x7f)


class NonAsciiApprovalTests(Base):
    def test_non_bmp_name_writes_valid_toml(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        blueprint.write_approval(path, blueprint.approval_block(1, "2026-11-13", "sha256:x", NAME))
        with open(path, "rb") as fh:
            cfg = tomllib.load(fh)
        self.assertEqual(cfg["approval"]["approved_by"], NAME)
        self.assertNotEqual(run("lint", d).returncode, 2)


class AppScopeTests(Base):
    def two_level(self):
        d = self.copy(os.path.join(FIX, "app_basic"))
        with open(os.path.join(d, "routines", "one", "routine.toml"), "a", encoding="utf-8") as fh:
            fh.write('\n[[requirement]]\nid = "r-desk"\ntext = "Shown in the Desk"\nserved_by = ["output:desk"]\n'
                     '\n[[requirement]]\nid = "r-stage"\ntext = "Bare name"\nserved_by = ["desk"]\n')
        return d

    def test_routine_requirement_covered_in_both_views(self):
        d = self.two_level()
        one = os.path.join(d, "routines", "one")
        routine_view = by_id(blueprint.derive(one))
        app_view = by_id(blueprint.derive(d, routine_dirs=[one]))
        for rid in ("r-desk", "r-stage"):
            self.assertFalse(routine_view[rid]["gap"], rid)
            self.assertEqual(routine_view[rid]["gap"], app_view[rid]["gap"], rid)
            self.assertEqual(app_view[rid]["unresolved"], [], rid)

    def test_routine_approval_is_not_the_app_approval(self):
        d = self.two_level()
        rt = os.path.join(d, "routines", "one", "routine.toml")
        with open(rt, "a", encoding="utf-8") as fh:
            fh.write('\n[approval]\nversion = 4\ndate = "2020-01-01"\nhash = "sha256:routine"\napproved_by = "R"\n')
        one = os.path.dirname(rt)
        self.assertEqual(blueprint.derive(one)["approval"]["approved_by"], "R")
        self.assertIsNone(blueprint.derive(d, routine_dirs=[one])["approval"])
        before = read(rt)
        code, out, err = run_tty(["blueprint", "approve", d], "Ada\napprove\n")
        self.assertEqual(code, 0, out + err)
        self.assertEqual(read(rt), before)
        self.assertIn('approved_by = "Ada"', read(os.path.join(d, "app.toml")).decode())
        self.assertIn("version = 1\n", read(os.path.join(d, "app.toml")).decode())


class DeskGraphTests(Base):
    def test_desk_config_graph_is_redacted_and_keeps_escape(self):
        d = self.copy()
        value = "sk-" + "a1B2c3D4e5F6g7H8i9J0k1L2"
        path = os.path.join(d, "routine.toml")
        text = read(path).decode().replace("Pages are checked every morning", f"</script> {value}").replace("Build the Worker.", f"Use {value}")
        write(path, text)
        html = routineos.desk_page("x", routine_dir=d)
        block = CONFIG_RE.search(html).group(2)
        self.assertNotIn(value, html)
        self.assertIn("[redacted]", block)
        self.assertIn("\\u003c/script\\u003e", block)
        self.assertNotIn("</script> [redacted]", html)

    def test_single_folder_app_desk_graph_has_app_requirements(self):
        d = self.copy(os.path.join(FIX, "app_plain"))
        with open(os.path.join(d, "app.toml"), "a", encoding="utf-8") as fh:
            fh.write('\n[[requirement]]\nid = "r-app"\ntext = "App level"\n')
        html = routineos.desk_page("x", routine_dir=d)
        g = json.loads(CONFIG_RE.search(html).group(2))["blueprint"]
        self.assertEqual([r["id"] for r in g["requirements"]], ["r-app"])
        self.assertIsNotNone(g["hash"])
        cli = json.loads(run("blueprint", d, "--json").stdout)
        self.assertEqual(g["hash"], cli["hash"])


class WriteApprovalTests(Base):
    def block(self):
        return blueprint.approval_block(2, "2026-11-13", "sha256:n", "Y")

    def test_comments_inside_approval_kept(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        with open(path, "a", encoding="utf-8") as fh:
            fh.write('\n[approval]\n# signed off by hand\nversion = 1\ndate = "2020-01-01"\nhash = "sha256:old"\napproved_by = "X"\n# end note\n\n[extra]\nk = 1\n')
        blueprint.write_approval(path, self.block())
        text = read(path).decode()
        self.assertIn("# signed off by hand", text)
        self.assertIn("# end note", text)
        self.assertNotIn("sha256:old", text)
        tomllib.loads(text)

    def test_inline_and_dotted_forms_refused_unchanged(self):
        for body in ('approval = { version = 1 }\n[x]\na = 1\n', 'approval.version = 1\n[x]\na = 1\n', '[x]\na = 1\n[approval.sub]\nb = 1\n'):
            with self.subTest(body=body):
                d = self.copy()
                path = os.path.join(d, "a.toml")
                write(path, body)
                with self.assertRaises(blueprint.BlueprintError) as cm:
                    blueprint.write_approval(path, self.block())
                self.assertIn("approval", str(cm.exception))
                self.assertEqual(read(path).decode(), body)

    def test_cli_refuses_inline_approval_with_message(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        write(path, 'approval = { version = 1, date = "2020-01-01", hash = "sha256:o", approved_by = "X" }\n' + read(path).decode())
        before = read(path)
        code, out, err = run_tty(["blueprint", "approve", d], "Ada\napprove\n")
        self.assertEqual(code, 2, out + err)
        self.assertEqual(read(path), before)

    def test_crlf_kept(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        write(path, read(path).decode().replace("\n", "\r\n"), newline="")
        blueprint.write_approval(path, self.block())
        blueprint.write_approval(path, blueprint.approval_block(3, "2026-11-14", "sha256:m", "Z"))
        data = read(path)
        self.assertEqual(data.count(b"\n"), data.count(b"\r\n"))
        self.assertEqual(data.count(b"[approval]"), 1)
        tomllib.loads(data.decode())


class SingleTableTests(Base):
    def test_single_requirement_and_infra_table_warn(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        write(path, '[routine]\nname = "solo"\ntype = "serverless"\nschedule = "0 6 * * *"\n\n[requirement]\nid = "r"\ntext = "t"\n\n[infra]\nname = "w"\n')
        g = blueprint.derive(d)
        self.assertTrue(any("[[requirement]]" in w and "single" in w for w in g["warnings"]), g["warnings"])
        self.assertTrue(any("[[infra]]" in w and "single" in w for w in g["warnings"]), g["warnings"])
        self.assertIn("WARN", run("lint", d).stdout)


class PackFixesTests(unittest.TestCase):
    def bp(self, **kw):
        p = minimal_pack()
        p["blueprint"] = kw
        return p

    def test_infra_label_limit_is_80(self):
        self.assertEqual(pack.validate(self.bp(infra=[{"name": "w", "label": "x" * 80}])), [])
        self.assertTrue(any("label" in x for x in pack.validate(self.bp(infra=[{"name": "w", "label": "x" * 81}]))))

    def test_infra_kind_checked(self):
        for k in ("worker", "queue", "d1", "r2", "browser-run", "ai", "do", "other"):
            self.assertEqual(pack.validate(self.bp(infra=[{"name": "w", "kind": k}])), [], k)
        self.assertTrue(any("kind" in x for x in pack.validate(self.bp(infra=[{"name": "w", "kind": "mainframe"}]))))

    def test_states_naming_no_part_refused(self):
        self.assertEqual(pack.validate(self.bp(states={"web": {"state": "docs"}})), [])
        self.assertTrue(any("matches no connector" in x for x in pack.validate(self.bp(states={"ghost": {"state": "docs"}}))))

    def test_verified_from_pack_installs_as_unverified(self):
        p = self.bp(states={"web": {"state": "verified", "needs": "n"}}, infra=[{"name": "w", "state": "verified"}])
        low = pack.lower_blueprint(p["blueprint"])
        self.assertEqual([i["state"] for i in low["integration"]], ["unverified"])
        self.assertEqual([i["state"] for i in low["infra"]], ["unverified"])
        self.assertEqual(p["blueprint"]["states"]["web"]["state"], "verified")  # input not mutated

    def test_relies_on_from_pack_is_not_installed(self):
        p = self.bp(states={"web": {"state": "docs", "relies_on": "rid"}},
                    infra=[{"name": "w", "state": "docs", "relies_on": ["rid"]}])
        self.assertEqual(pack.validate(p), [])
        low = pack.lower_blueprint(p["blueprint"])
        self.assertTrue(all("relies_on" not in r for r in low["integration"] + low["infra"]))
        self.assertEqual(p["blueprint"]["states"]["web"]["relies_on"], "rid")  # input not mutated
        self.assertEqual(pack.validate(json.loads(pack.dumps(p))), [])
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        target = os.path.join(tmp, "demo")
        pack.install(p, target, lambda name: "<html></html>")
        with open(os.path.join(target, "routine.toml"), encoding="utf-8") as fh:
            text = fh.read()
        self.assertNotIn("relies_on", text)
        g = blueprint.derive(target, records={"rid": {"status": "pilot-verified"}})
        states = {n["id"]: n["state"] for n in g["nodes"] if n["state"]}
        self.assertTrue(states)
        self.assertNotIn("verified", states.values(), states)

    def test_schema_agrees_with_validator(self):
        from jsonschema_subset import validate as schema_validate
        with open(os.path.join(ROOT, "catalog", "schema", "pack.v1.schema.json"), encoding="utf-8") as fh:
            s = json.load(fh)
        self.assertEqual(schema_validate(self.bp(infra=[{"name": "w", "kind": "d1", "label": "x" * 80}]), s), [])
        self.assertTrue(schema_validate(self.bp(infra=[{"name": "w", "kind": "mainframe"}]), s))
        self.assertTrue(schema_validate(self.bp(infra=[{"name": "w", "label": "x" * 81}]), s))


if __name__ == "__main__":
    unittest.main()
