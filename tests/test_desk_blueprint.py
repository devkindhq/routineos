"""The Blueprint Desk page is a separate build variant: only a routine with a Blueprint gets it, the main page stays
free of React Flow and dagre, and the graph reaches the page escaped."""
import json
import os
import re
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))
sys.path.insert(0, os.path.join(ROOT, "tests"))

import bundle_desk  # noqa: E402
import pack as routine_pack  # noqa: E402
import routineos  # noqa: E402
from pack_fixtures import minimal_pack  # noqa: E402

DESK = bundle_desk.DESK
AUTHORED = os.path.join(ROOT, "tests", "fixtures", "blueprint", "authored")
TEMPLATES = os.path.join(ROOT, "templates")
META_RE = bundle_desk.META_RE
CONFIG_RE = bundle_desk.CONFIG_RE


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def meta_hash(html):
    m = META_RE.search(html)
    return m.group(1) if m else None


def config_of(html):
    return json.loads(CONFIG_RE.search(html).group(2))


class DeskPageVariantTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)

    def authored_copy(self, replace=None):
        d = os.path.join(self.tmp, "authored")
        shutil.copytree(AUTHORED, d)
        if replace:
            path = os.path.join(d, "routine.toml")
            text = read(path)
            for old, new in replace.items():
                self.assertIn(old, text)
                text = text.replace(old, new)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text)
        return d

    def test_desk_page_without_blueprint_uses_main_page(self):
        main_hash = meta_hash(read(bundle_desk.HTML))
        names = sorted(n for n in os.listdir(TEMPLATES) if os.path.isfile(os.path.join(TEMPLATES, n, "routine.toml")))
        self.assertTrue(names)
        for name in names:
            with self.subTest(template=name):
                # routine.toml only: a template's custom components need an approval this test is not about
                d = os.path.join(self.tmp, "t-" + name)
                os.makedirs(d)
                shutil.copy(os.path.join(TEMPLATES, name, "routine.toml"), d)
                html = routineos.desk_page(name, routine_dir=d)
                self.assertEqual(meta_hash(html), main_hash)
                self.assertNotIn("react-flow", html)
                self.assertNotIn("blueprint", config_of(html))

    def test_desk_page_with_blueprint_uses_variant(self):
        html = routineos.desk_page("authored", routine_dir=AUTHORED)
        self.assertEqual(meta_hash(html), meta_hash(read(bundle_desk.BLUEPRINT_HTML)))
        self.assertNotEqual(meta_hash(html), meta_hash(read(bundle_desk.HTML)))
        self.assertEqual(config_of(html)["blueprint"]["format"], "routineos.blueprint.v1")
        self.assertEqual(config_of(html)["store"], "db")

    def test_blueprint_id_clash_raises(self):
        d = self.authored_copy()
        comp = os.path.join(d, "desk", "components", "blueprint")
        os.makedirs(comp)
        with open(os.path.join(comp, "component.json"), "w", encoding="utf-8") as fh:
            json.dump({"id": "blueprint", "factory": "component_blueprint", "slot": "page", "title": "x"}, fh)
        with open(os.path.join(comp, "blueprint.js"), "w", encoding="utf-8") as fh:
            fh.write("function component_blueprint(ctx, props, ui) { return null; }\n")
        with self.assertRaises(routineos.DeskPageError) as cm:
            routineos.desk_page("authored", routine_dir=d)
        self.assertEqual(cm.exception.problems,
                         ["a custom component is named 'blueprint', which the built-in Blueprint page uses; rename it"])

    def test_graph_label_with_script_tag_is_escaped(self):
        d = self.authored_copy({"Pages are checked every morning": "</script><b>x"})
        html = routineos.desk_page("authored", routine_dir=d)
        # the config block holds the < escape config_json produces, never a literal closing tag
        block = CONFIG_RE.search(html).group(2)
        self.assertIn("\\u003c/script\\u003e\\u003cb\\u003ex", block)
        self.assertNotIn("</script><b>x", html)
        self.assertEqual(config_of(html)["blueprint"]["requirements"][0]["text"], "</script><b>x")
        self.assertEqual(html.count('id="desk-config"'), 1)

    def test_variant_src_hash_fresh(self):
        self.assertEqual(meta_hash(read(bundle_desk.BLUEPRINT_HTML)),
                         bundle_desk.src_hash(DESK, bundle_desk.BLUEPRINT_DIRS, bundle_desk.BLUEPRINT_FILES),
                         "index.blueprint.html is stale; run npm --prefix skills/routineos/assets/desk run build:blueprint")

    def test_variant_hash_differs_from_main_hash(self):
        self.assertNotEqual(bundle_desk.src_hash(DESK, bundle_desk.BLUEPRINT_DIRS, bundle_desk.BLUEPRINT_FILES),
                            bundle_desk.src_hash(DESK))

    def test_main_page_has_no_react_flow(self):
        html = read(bundle_desk.HTML)
        self.assertNotIn("react-flow", html)
        self.assertNotIn("dagre", html)

    def test_variant_page_has_react_flow(self):
        self.assertIn("react-flow", read(bundle_desk.BLUEPRINT_HTML))

    def test_blueprint_key_is_a_known_config_key(self):
        self.assertIn("blueprint", bundle_desk.CONFIG_KEYS)

    def test_bundle_check_covers_both_pages(self):
        self.assertEqual(bundle_desk.main(["--check"]), 0)

    def test_pack_install_call_site(self):
        """routineos pack install passes routine_dir=target before target exists: no crash, and the main page is written.
        The variant appears once the folder is bundled."""
        from test_pack_blueprint import with_blueprint
        p = with_blueprint(requirements=[{"id": "r1", "text": "Reads pages"}])
        target = os.path.join(self.tmp, "installed")
        routine_pack.install(p, target, desk_html=lambda name: routineos.desk_page(name, routine_dir=target))
        installed = read(os.path.join(target, "dashboard", "index.html"))
        self.assertEqual(meta_hash(installed), meta_hash(read(bundle_desk.HTML)))
        self.assertEqual(meta_hash(routineos.desk_page("authored", routine_dir=target)),
                         meta_hash(read(bundle_desk.BLUEPRINT_HTML)))

    def test_pack_install_without_blueprint_unchanged(self):
        target = os.path.join(self.tmp, "plain")
        routine_pack.install(minimal_pack(), target, desk_html=lambda name: routineos.desk_page(name, routine_dir=target))
        self.assertNotIn("react-flow", read(os.path.join(target, "dashboard", "index.html")))


if __name__ == "__main__":
    unittest.main()
