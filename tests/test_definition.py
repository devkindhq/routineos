import copy
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "skills", "routineos", "scripts")
CLI = os.path.join(SCRIPTS, "routineos.py")
WATCH = os.path.join(ROOT, "templates", "watch")
sys.path.insert(0, SCRIPTS)

import definition  # noqa: E402
import schema  # noqa: E402


def watch_defn():
    return definition.load(os.path.join(WATCH, "definition.json"))


def watch_settings():
    return schema.load(os.path.join(WATCH, "routine.toml")).get("setting", [])


def company_defn(identity="domain"):
    return {
        "version": 1,
        "label": "Producer",
        "inbox": False,
        "types": {
            "company": {
                "label": "Company",
                "plural": "Companies",
                "identity": identity,
                "fields": {"name": {"type": "text", "summary": True}, "domain": {"type": "url"}},
            }
        },
    }


def producer(pid, defn, settings=()):
    return {"id": pid, "label": pid, "schedule": "0 22 * * 1", "definition": defn, "settings": list(settings)}


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import join_fixtures  # noqa: E402


class LintTests(unittest.TestCase):
    def test_watch_definition_passes(self):
        self.assertEqual(definition.lint(watch_defn(), watch_settings()), [])

    def test_missing_identity_fails(self):
        d = watch_defn()
        del d["types"]["item"]["identity"]
        problems = definition.lint(d, watch_settings())
        self.assertTrue([p for p in problems if "item" in p and "identity" in p], problems)

    def test_identity_field_must_be_declared(self):
        d = watch_defn()
        d["types"]["item"]["identity"] = "field:nope"
        self.assertTrue(definition.lint(d, watch_settings()))

    def test_link_to_undeclared_type_fails(self):
        d = watch_defn()
        d["types"]["item"]["links"] = ["company"]
        problems = definition.lint(d, watch_settings())
        self.assertTrue([p for p in problems if "company" in p], problems)

    def test_unknown_field_type_fails(self):
        d = watch_defn()
        d["types"]["item"]["fields"]["title"]["type"] = "blob"
        self.assertTrue([p for p in definition.lint(d, watch_settings()) if "blob" in p])

    def test_view_with_undeclared_field_fails(self):
        d = watch_defn()
        d["views"][0]["columns"].append("nope")
        self.assertTrue([p for p in definition.lint(d, watch_settings()) if "nope" in p])

    def test_view_in_desk_shape_passes(self):
        d = watch_defn()
        d["views"][0].update({
            "filters": {"status": "dropped", "q": "shop", "starred": True, "reason": "excluded",
                        "fields": {"source": "Board A"}},
            "window": "month", "group": "source", "columns": ["title", "dropReason"]})
        self.assertEqual(definition.lint(d, watch_settings()), [])

    def test_view_field_filter_at_top_level_fails(self):
        d = watch_defn()
        d["views"][0]["filters"] = {"title": "Shopify developer"}
        problems = definition.lint(d, watch_settings())
        self.assertTrue([p for p in problems if "filters.fields" in p], problems)

    def test_view_field_filter_names_declared_field(self):
        d = watch_defn()
        d["views"][0]["filters"] = {"fields": {"nope": "x"}}
        self.assertTrue([p for p in definition.lint(d, watch_settings()) if "nope" in p])

    def test_view_group_is_a_field_name(self):
        d = watch_defn()
        d["views"][0]["group"] = {"field": "source"}
        self.assertTrue([p for p in definition.lint(d, watch_settings()) if "group" in p])
        d["views"][0]["group"] = "nope"
        self.assertTrue([p for p in definition.lint(d, watch_settings()) if "nope" in p])

    def test_view_status_and_window_values(self):
        d = watch_defn()
        d["views"][0]["filters"] = {"status": "gone"}
        d["views"][0]["window"] = "year"
        problems = definition.lint(d, watch_settings())
        self.assertTrue([p for p in problems if "filters.status" in p], problems)
        self.assertTrue([p for p in problems if "window" in p], problems)

    def test_view_meta_fields_match_browse(self):
        # Lint allows exactly the meta fields browse.js can show, so the two cannot drift apart.
        src = os.path.join(ROOT, "skills", "routineos", "assets", "desk", "core", "pages", "browse.js")
        with open(src, encoding="utf-8") as fh:
            found = re.search(r"export var BROWSE_META = \{([^}]*)\}", fh.read())
        self.assertIsNotNone(found)
        meta = found.group(1) if found else ""
        self.assertEqual(set(re.findall(r"(\w+):", meta)), set(definition.VIEW_META_FIELDS))

    def test_nav_icons_are_desk_icons(self):
        # Every icon a type or view may name is in the Desk's ICON_NAMES and drawn by app/icons.js.
        desk = os.path.join(ROOT, "skills", "routineos", "assets", "desk")
        with open(os.path.join(desk, "core", "shared.js"), encoding="utf-8") as fh:
            names = set(re.findall(r'"([a-z0-9-]+)"', re.search(r"export var ICON_NAMES = \[([^\]]*)\]", fh.read()).group(1)))
        with open(os.path.join(desk, "app", "icons.js"), encoding="utf-8") as fh:
            body = re.search(r"export var ICONS = \{(.*?)\};", fh.read(), re.S).group(1)
        drawn = set(re.findall(r'"?([a-z0-9-]+)"?: Icon', body))
        self.assertEqual(set(definition.NAV_ICONS) - names, set())
        self.assertEqual(drawn, names)
        for name in ("desk", "improve", "desk-mark"):
            self.assertNotIn(name, definition.NAV_ICONS)

    def test_nav_icons_match_the_pack_schema(self):
        with open(os.path.join(ROOT, "catalog", "schema", "pack.v1.schema.json"), encoding="utf-8") as fh:
            pack = json.load(fh)
        for kind in ("type", "view"):
            self.assertEqual(pack["$defs"][kind]["properties"]["icon"]["enum"], list(definition.NAV_ICONS))

    def test_double_dash_type_name_fails(self):
        d = watch_defn()
        d["types"]["news--item"] = d["types"].pop("item")
        d["views"] = []
        self.assertTrue(definition.lint(d, watch_settings()))

    def test_inbox_needs_max_inbox_per_run(self):
        d = watch_defn()
        d["inbox"] = True
        problems = definition.lint(d, watch_settings())
        self.assertTrue([p for p in problems if "max_inbox_per_run" in p], problems)
        ok = watch_settings() + [{"name": "max_inbox_per_run", "type": "number", "default": 5}]
        self.assertEqual(definition.lint(d, ok), [])

    def test_type_and_view_icons_must_be_desk_icons(self):
        d = watch_defn()
        d["types"]["item"]["icon"] = "newspaper"
        d["views"][0]["icon"] = "globe"
        self.assertEqual(definition.lint(d, watch_settings()), [])
        d["types"]["item"]["icon"] = "sparkles"
        d["views"][0]["icon"] = 7
        problems = definition.lint(d, watch_settings())
        self.assertTrue([p for p in problems if p.startswith("type 'item': icon 'sparkles' is not a Desk icon")], problems)
        self.assertTrue([p for p in problems if "icon 7 is not a Desk icon" in p and "house" in p], problems)

    def test_setting_filter_needs_role_and_field(self):
        d = watch_defn()
        d["types"]["item"]["settingFilters"] = [{"setting": "sources", "field": "source"}]
        self.assertTrue([p for p in definition.lint(d, watch_settings()) if "role" in p])
        settings = watch_settings()
        for s in settings:
            if s["name"] == "sources":
                s["role"] = "include"
        self.assertEqual(definition.lint(d, settings), [])
        d["types"]["item"]["settingFilters"][0]["field"] = "nope"
        self.assertTrue(definition.lint(d, settings))


class SettingKeyTests(unittest.TestCase):
    def lint(self, setting):
        cfg = {"routine": {"name": "d", "type": "watch", "schedule": "0 * * * *"}, "setting": [setting]}
        return schema.lint(cfg, "is data, not instructions\nPush rule: x\n")

    def test_role_on_non_list_fails(self):
        problems = self.lint({"name": "n", "type": "number", "default": 1, "role": "include"})
        self.assertTrue([p for p in problems if "role" in p], problems)

    def test_role_on_list_passes(self):
        for role in ("include", "exclude"):
            self.assertEqual(self.lint({"name": "n", "type": "list", "default": [], "role": role}), [])

    def test_unknown_role_fails(self):
        self.assertTrue(self.lint({"name": "n", "type": "list", "default": [], "role": "maybe"}))

    def test_label_and_example_must_be_text(self):
        self.assertEqual(self.lint({"name": "n", "type": "toggle", "default": True,
                                    "label": "Run quietly", "example": "true"}), [])
        self.assertTrue(self.lint({"name": "n", "type": "toggle", "default": True, "label": 3}))


class CompileTests(unittest.TestCase):
    def test_conflicting_identity_rules_fail(self):
        with self.assertRaises(definition.DefinitionError) as cm:
            definition.compile([producer("a", company_defn("domain")), producer("b", company_defn("name"))])
        self.assertIn("company", str(cm.exception))

    def test_icon_carries_and_the_first_producer_wins(self):
        a, b, c = company_defn(), company_defn(), company_defn()
        b["types"]["company"]["icon"] = "building-2"
        c["types"]["company"]["icon"] = "briefcase"
        self.assertNotIn("icon", definition.compile([producer("a", a)])["types"]["company"])
        out = definition.compile([producer("a", a), producer("b", b), producer("c", c)])
        self.assertEqual(out["types"]["company"]["icon"], "building-2")

    def test_same_rule_shares_the_type(self):
        out = definition.compile([producer("a", company_defn()), producer("b", company_defn())])
        self.assertEqual(out["types"]["company"]["producers"], ["a", "b"])

    def test_output_has_version_and_union_of_types(self):
        out = definition.compile([producer("watch", watch_defn(), watch_settings()), producer("b", company_defn())])
        self.assertTrue(out["version"])
        self.assertEqual(sorted(out["types"]), ["company", "item"])
        self.assertEqual([p["id"] for p in out["producers"]], ["watch", "b"])
        self.assertEqual(out["producers"][0]["types"], ["item"])
        self.assertIn("lookback_days", [s["name"] for s in out["producers"][0]["settings"]])
        self.assertEqual(out["views"][0]["producer"], "watch")

    def test_field_order_is_kept_as_declared(self):
        a = company_defn()
        a["types"]["company"]["fields"] = {"name": {"type": "text"}, "domain": {"type": "url"}}
        b = company_defn()
        b["types"]["company"]["fields"] = {"zone": {"type": "text"}, "domain": {"type": "url"}, "abn": {"type": "text"}}
        out = definition.compile([producer("a", a), producer("b", b)])
        self.assertEqual(out["types"]["company"]["order"], ["name", "domain", "zone", "abn"])

    def test_version_is_deterministic_and_tracks_content(self):
        a = definition.compile([producer("a", company_defn())])
        b = definition.compile([producer("a", company_defn())])
        self.assertEqual(a, b)
        changed = company_defn()
        changed["types"]["company"]["fields"]["size"] = {"type": "number"}
        self.assertNotEqual(definition.compile([producer("a", changed)])["version"], a["version"])

    def test_setting_filters_compile_to_one_list_tagged_by_producer(self):
        settings = [{"name": "blocked", "type": "list", "default": [], "role": "exclude"}]
        a = company_defn()
        a["types"]["company"]["settingFilters"] = [{"setting": "blocked", "field": "domain"}]
        out = definition.compile([producer("a", a, settings), producer("b", company_defn())])
        self.assertEqual(out["types"]["company"]["settingFilters"],
                         [{"producer": "a", "setting": "blocked", "field": "domain"}])

    def test_lint_problems_raise_on_compile(self):
        bad = company_defn()
        del bad["types"]["company"]["identity"]
        with self.assertRaises(definition.DefinitionError):
            definition.compile([producer("a", bad)])

    def test_oversized_definition_fails(self):
        big = copy.deepcopy(company_defn())
        for i in range(3000):
            big["types"]["company"]["fields"][f"f{i:04d}_" + "x" * 80] = {"type": "text"}
        with self.assertRaises(definition.DefinitionError) as cm:
            definition.compile([producer("a", big)])
        self.assertIn("256 KiB", str(cm.exception))


def role_defn(health=None):
    defn = {
        "version": 1, "label": "Jobs", "inbox": False,
        "types": {
            "role": {"label": "Role", "plural": "Roles", "identity": "field:url",
                     "fields": {"url": {"type": "url"}, "market": {"type": "choice", "choices": ["AU", "GB", "DE"]}}},
            "company": copy.deepcopy(company_defn()["types"]["company"]),
        },
    }
    if health is not None:
        defn["desk"] = {"health": health}
    return defn


class HealthTests(unittest.TestCase):
    """desk.health (spec 7c): a per-type mapping of one field's values to red, yellow and green."""
    ROLE = {"role": {"field": "market", "red": ["DE"], "yellow": ["GB"], "green": ["AU"]}}

    def lint(self, health):
        return definition.lint(role_defn(health), [])

    def test_valid_health_lints_clean(self):
        self.assertEqual(self.lint(self.ROLE), [])

    def test_unknown_type_field_overlap_and_shape(self):
        self.assertTrue(any("nope" in p for p in self.lint({"nope": {"field": "market", "red": [], "yellow": [], "green": []}})))
        self.assertTrue(any("salary" in p for p in self.lint({"role": {"field": "salary", "red": [], "yellow": [], "green": []}})))
        overlap = self.lint({"role": {"field": "market", "red": ["DE"], "yellow": ["DE"], "green": []}})
        self.assertTrue(any("DE" in p for p in overlap), overlap)
        self.assertTrue(self.lint({"role": {"field": "market", "red": "DE"}}))
        self.assertTrue(self.lint({"role": {"field": "market", "red": [], "yellow": [], "green": [], "blue": []}}))
        self.assertTrue(self.lint([]))

    def test_other_desk_keys_still_rejected(self):
        defn = role_defn(self.ROLE)
        defn["desk"]["colours"] = {}
        self.assertTrue(any("colours" in p for p in definition.lint(defn, [])))

    def test_compile_embeds_health_only_when_declared(self):
        plain = definition.compile([producer("a", role_defn())])
        self.assertNotIn("desk", plain)
        out = definition.compile([producer("a", role_defn(self.ROLE))])
        self.assertEqual(out["desk"], {"health": self.ROLE})

    def test_identical_mappings_from_two_producers_pass(self):
        out = definition.compile([producer("a", role_defn(self.ROLE)), producer("b", role_defn(self.ROLE))])
        self.assertEqual(out["desk"]["health"], self.ROLE)

    def test_different_mappings_for_one_type_fail_naming_both(self):
        a = {"company": {"field": "name", "red": ["x"], "yellow": [], "green": []}}
        b = {"company": {"field": "name", "red": ["y"], "yellow": [], "green": []}}
        with self.assertRaises(definition.DefinitionError) as cm:
            definition.compile([producer("jobs-watch", role_defn(a)), producer("lead-signals", role_defn(b))])
        self.assertIn("jobs-watch", str(cm.exception))
        self.assertIn("lead-signals", str(cm.exception))


class RecordStripTests(unittest.TestCase):
    """desk.record.strip: a per-type list of chips and fields the record page draws in its strip."""
    STRIP = {"role": [{"chip": "state"}, {"field": "market"}, {"chip": "decision"}]}

    def defn(self, strip):
        defn = role_defn()
        defn["desk"] = {"record": {"strip": strip}}
        return defn

    def lint(self, strip):
        return definition.lint(self.defn(strip), [])

    def test_valid_strip_lints_clean(self):
        self.assertEqual(self.lint(self.STRIP), [])

    def test_strip_unknown_field_fails_lint(self):
        problems = self.lint({"role": [{"field": "salary"}]})
        self.assertTrue(any("salary" in p for p in problems), problems)

    def test_strip_unknown_chip_type_and_shape_fail_lint(self):
        self.assertTrue(any("sparkle" in p for p in self.lint({"role": [{"chip": "sparkle"}]})))
        self.assertTrue(any("nope" in p for p in self.lint({"nope": [{"chip": "state"}]})))
        self.assertTrue(self.lint({"role": [{"chip": "state", "field": "market"}]}))
        self.assertTrue(self.lint({"role": [{}]}))
        self.assertTrue(self.lint({"role": "state"}))
        self.assertTrue(self.lint({"role": [{"chip": "state"}] * 9}))
        self.assertTrue(self.lint([]))

    def test_unknown_record_key_fails_lint(self):
        defn = self.defn(self.STRIP)
        defn["desk"]["record"]["rail"] = {}
        self.assertTrue(any("rail" in p for p in definition.lint(defn, [])))

    def test_compile_embeds_strip_only_when_declared(self):
        out = definition.compile([producer("a", self.defn(self.STRIP))])
        self.assertEqual(out["desk"], {"record": {"strip": self.STRIP}})
        self.assertNotIn("desk", definition.compile([producer("a", role_defn())]))

    def test_different_strips_for_one_type_fail_naming_both(self):
        other = {"role": [{"chip": "run"}]}
        with self.assertRaises(definition.DefinitionError) as cm:
            definition.compile([producer("jobs-watch", self.defn(self.STRIP)), producer("lead-signals", self.defn(other))])
        self.assertIn("jobs-watch", str(cm.exception))
        self.assertIn("lead-signals", str(cm.exception))


class CompileCliTests(unittest.TestCase):
    def test_compile_watch_writes_meta_definition(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "meta-definition.json")
            r = subprocess.run([sys.executable, CLI, "compile", WATCH, "--out", out], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            with open(out) as fh:
                data = json.load(fh)
            self.assertEqual([p["id"] for p in data["producers"]], ["watch"])

    def test_compile_lint_failure_exits_1(self):
        with tempfile.TemporaryDirectory() as tmp:
            for f in ("routine.toml", "prompt.md"):
                with open(os.path.join(WATCH, f)) as src, open(os.path.join(tmp, f), "w") as dst:
                    dst.write(src.read())
            bad = watch_defn()
            del bad["types"]["item"]["identity"]
            with open(os.path.join(tmp, "definition.json"), "w") as fh:
                json.dump(bad, fh)
            r = subprocess.run([sys.executable, CLI, "compile", tmp, "--out", os.path.join(tmp, "o.json")],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("identity", r.stdout)
            self.assertNotIn("Traceback", r.stderr)

    def test_lint_checks_definition_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            for f in ("routine.toml", "prompt.md"):
                with open(os.path.join(WATCH, f)) as src, open(os.path.join(tmp, f), "w") as dst:
                    dst.write(src.read())
            bad = watch_defn()
            del bad["types"]["item"]["identity"]
            with open(os.path.join(tmp, "definition.json"), "w") as fh:
                json.dump(bad, fh)
            r = subprocess.run([sys.executable, CLI, "lint", tmp], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("identity", r.stdout)

    def test_compile_missing_dir_exits_2(self):
        r = subprocess.run([sys.executable, CLI, "compile", os.path.join(ROOT, "nope")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertNotIn("Traceback", r.stderr)


class JoinCompileTests(unittest.TestCase):
    def defn(self, card=None):
        d = copy.deepcopy(watch_defn())
        d["types"].update(copy.deepcopy(join_fixtures.DRAFT_TYPES))
        if card is not None:
            d["join"] = copy.deepcopy(card)
        return d

    def test_join_block_compiles_beside_the_definition(self):
        out = definition.compile([producer("a", self.defn(join_fixtures.TWO_LANE_CARD), watch_settings())])
        self.assertEqual(out["join"]["lanes"][0]["id"], "sender")
        plain = definition.compile([producer("a", self.defn(), watch_settings())])
        self.assertEqual(out["version"], plain["version"])
        self.assertNotIn("join", plain)

    def test_second_join_block_fails_compile(self):
        with self.assertRaises(definition.DefinitionError) as cm:
            definition.compile([producer("a", self.defn(join_fixtures.TWO_LANE_CARD), watch_settings()),
                                producer("b", self.defn(join_fixtures.TWO_LANE_CARD), watch_settings())])
        self.assertIn("join: only one definition.json may carry a join block (found in a and b)",
                      cm.exception.problems)

    def test_join_block_problems_fail_compile(self):
        with self.assertRaises(definition.DefinitionError) as cm:
            definition.compile([producer("a", self.defn(join_fixtures.UNKNOWN_KIND_CARD), watch_settings())])
        self.assertTrue(any("unknown worker kind 'shell-exec'" in p for p in cm.exception.problems))

    def test_join_match_type_must_be_declared_after_merge(self):
        d = copy.deepcopy(watch_defn())
        d["join"] = copy.deepcopy(join_fixtures.TWO_LANE_CARD)
        with self.assertRaises(definition.DefinitionError) as cm:
            definition.compile([producer("a", d, watch_settings())])
        self.assertTrue(any("match type 'draft' is not declared" in p for p in cm.exception.problems))


if __name__ == "__main__":
    unittest.main()
