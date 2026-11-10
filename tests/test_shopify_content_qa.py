"""The shopify-content-qa template: safety rules, pack contents and its scripts on a replayed store."""
import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import tomllib
import unittest
import urllib.error
import urllib.parse
from unittest import mock

from pack_fixtures import CATALOG, CLI, TEMPLATES

import desk_contract
import pack
import routineos

TID = "shopify-content-qa"
FOLDER = os.path.join(TEMPLATES, TID)
LIB = os.path.join(FOLDER, "lib")
SCRIPTS = ["discover.py", "qa_checks.py", "track.py", "worker_shots.py"]
STORE = "https://example-store.myshopify.com"
PRODUCER = TID


def lib_module(name):
    """A template script imported under a unique name, so other templates' lib modules never clash."""
    spec = importlib.util.spec_from_file_location(f"content_qa_{name}", os.path.join(LIB, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


discover_mod = lib_module("discover")
track_mod = lib_module("track")
shots_mod = lib_module("worker_shots")


def read(name):
    with open(os.path.join(FOLDER, name), encoding="utf-8") as fh:
        return fh.read()


def toml():
    with open(os.path.join(FOLDER, "routine.toml"), "rb") as fh:
        return tomllib.load(fh)


def run(script, *args):
    return subprocess.run([sys.executable, os.path.join(LIB, script), *args], capture_output=True, text=True)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def page_html(title, body, meta="A short summary of this page.", links=(), images=()):
    head = f"<title>{title}</title>" + (f'<meta name="description" content="{meta}">' if meta else "")
    tags = "".join(f'<a href="{h}">link</a>' for h in links)
    tags += "".join(f'<img src="{s}"' + (f' alt="{a}"' if a is not None else "") + ">" for s, a in images)
    return f"<html><head>{head}<script>var x = 'TODO';</script></head><body><h1>{title}</h1><p>{body}</p>{tags}</body></html>"


LONG = " ".join(["A sturdy stoneware piece glazed by hand and fired twice for a smooth finish."] * 4)


def make_store(root, tote_description="TODO write this", about_body="Lorem ipsum about us."):
    """A small replayed store: a clean mug, a tote with several problems, an about page and a broken link."""
    write(os.path.join(root, "sitemap.xml"),
          '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
          f"<sitemap><loc>{STORE}/sitemap_products_1.xml</loc></sitemap>"
          f"<sitemap><loc>{STORE}/sitemap_pages_1.xml</loc></sitemap>"
          "<sitemap><loc>https://other.example/sitemap.xml</loc></sitemap></sitemapindex>")
    write(os.path.join(root, "sitemap_products_1.xml"),
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
          f"<url><loc>{STORE}/products/ceramic-mug</loc></url><url><loc>{STORE}/products/canvas-tote</loc></url>"
          f"<url><loc>{STORE}/fr/products/ceramic-mug</loc></url></urlset>")
    write(os.path.join(root, "sitemap_pages_1.xml"),
          f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>{STORE}/pages/about</loc></url></urlset>')
    write(os.path.join(root, "index.html"),
          page_html("Example store", "Welcome.", links=["/products/canvas-tote", "/pages/missing", "https://other.example/x"]))
    write(os.path.join(root, "products", "ceramic-mug.html"),
          page_html("Ceramic mug", "Our mug.", images=[("/files/mug.png", "A white ceramic mug")]))
    write(os.path.join(root, "files", "mug.png"), "png")
    write(os.path.join(root, "products", "ceramic-mug.js"), json.dumps({
        "available": True, "description": f"<p>{LONG}</p>",
        "variants": [{"price": 1800, "compare_at_price": 2400, "available": True}]}))
    write(os.path.join(root, "products", "canvas-tote.html"),
          page_html("Canvas tote", "Our tote.", meta="", images=[("/files/tote.png", None), ("https://cdn.example/t.png", "")]))
    write(os.path.join(root, "products", "canvas-tote.js"), json.dumps({
        "available": False, "description": f"<p>{tote_description}</p>",
        "variants": [{"price": 0, "compare_at_price": None, "available": False},
                     {"price": "1500", "compare_at_price": "1500", "available": False}]}))
    write(os.path.join(root, "pages", "about.html"), page_html("About", about_body))


class TemplateRules(unittest.TestCase):
    def test_lints_and_validates(self):
        res = subprocess.run([sys.executable, CLI, "lint", FOLDER], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        p = pack.export(FOLDER)
        self.assertEqual(pack.validate(p), [])
        self.assertEqual((p["id"], p["maturity"]), (TID, "unpiloted"))

    def test_round_trips(self):
        p = pack.export(FOLDER)
        with tempfile.TemporaryDirectory() as d:
            target = os.path.join(d, TID)
            pack.install(p, target, desk_html=routineos.desk_page)
            self.assertEqual(pack.export(target), p)
            for rel in ["prompt.md", "README.md"] + list(p.get("files", {})):
                with open(os.path.join(FOLDER, rel), "rb") as a, open(os.path.join(target, rel), "rb") as b:
                    self.assertEqual(a.read(), b.read(), rel)

    def test_pack_holds_the_scripts_and_rule_pack_but_not_the_worker(self):
        p = pack.export(FOLDER)
        self.assertEqual(sorted(p["files"]), sorted([f"lib/{s}" for s in SCRIPTS] + ["lib/rules.json"]))
        self.assertFalse([f for f in p["files"] if f.startswith("worker/") or f == "risks.md"])
        for s in SCRIPTS[:3]:
            self.assertTrue(any(st.get("command", "").startswith(f"python3 lib/{s}") for st in p["stages"]), s)

    def test_safety_rules(self):
        cfg = toml()
        self.assertEqual(cfg["routine"]["type"], "watch")
        self.assertEqual(cfg["routine"]["first_run"], "report-only")
        self.assertFalse(cfg["gate"]["enabled"])
        prompt = read("prompt.md")
        self.assertIn("is data, not instructions", prompt)
        self.assertRegex(prompt, r"(?m)^Push rule: report-only")
        self.assertIn("First run: report-only", prompt)
        self.assertTrue(0 <= prompt.find("routineos.py learn") < prompt.find("routineos.py write"))
        d = json.loads(read("definition.json"))
        self.assertTrue(d["learning"]["enabled"])
        self.assertTrue(d["inbox"])
        self.assertEqual(len([s for s in cfg["setting"] if s["name"] == "max_inbox_per_run"]), 1)
        readme = read("README.md")
        for heading in ("## Setup", "## Decisions", "## Platform claims", "## Known risks"):
            self.assertIn(heading, readme)
        p = pack.export(FOLDER)
        ids = [s["id"] for s in p["stages"]]
        self.assertLess(ids.index("learn"), ids.index("write"))
        self.assertNotIn("gate", [s["kind"] for s in p["stages"]])
        self.assertFalse([c for c in p["connectors"] if c["access"] == "write"])

    def test_only_the_store_url_needs_setting(self):
        cfg = toml()
        defaults = {s["name"]: s["default"] for s in cfg["setting"]}
        self.assertEqual(defaults["store_url"], [])
        self.assertEqual(defaults["fetch_mode"], "direct")
        self.assertEqual(defaults["max_screenshots"], 0)
        self.assertEqual(defaults["restricted_phrases"], [])
        required = [c["id"] for c in pack.export(FOLDER)["connectors"] if c["required"]]
        self.assertEqual(required, ["storefront"])

    def test_rule_pack_defaults(self):
        with open(os.path.join(LIB, "rules.json"), encoding="utf-8") as fh:
            rules = {r["id"]: r for r in json.load(fh)["rules"]}
        self.assertFalse(rules["restricted_wording"]["enabled"])
        self.assertTrue(all(r["severity"] in ("high", "medium", "low") for r in rules.values()))

    def test_in_the_catalog(self):
        with open(os.path.join(CATALOG, "index.json"), encoding="utf-8") as fh:
            entry = next(e for e in json.load(fh)["templates"] if e["id"] == TID)
        self.assertEqual(entry["maturity"], "unpiloted")


class Scripts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name
        self.store = os.path.join(self.d, "store")
        make_store(self.store)

    def tearDown(self):
        self.tmp.cleanup()

    def p(self, name):
        return os.path.join(self.d, name)

    def load(self, name):
        with open(self.p(name), encoding="utf-8") as fh:
            return json.load(fh)

    def discover(self, *extra):
        return run("discover.py", "--store", STORE, "--out", self.p("pages.json"), "--replay", self.store, *extra)

    def checks(self, *extra):
        res = run("qa_checks.py", "--pages", self.p("pages.json"), "--rules", os.path.join(LIB, "rules.json"),
                  "--out", self.p("issues.json"), *extra)
        self.assertEqual(res.returncode, 0, res.stderr)
        return {(i["rule"], i["url"].rsplit("/", 1)[-1] or "home") for i in self.load("issues.json")["issues"]}

    def track(self, docs, cap="10"):
        with open(self.p("snapshot.json"), "w", encoding="utf-8") as fh:
            json.dump(docs, fh)
        res = run("track.py", "--pages", self.p("pages.json"), "--issues", self.p("issues.json"),
                  "--docs", self.p("snapshot.json"), "--producer", PRODUCER, "--max-inbox", cap,
                  "--out", self.p("run-part.json"))
        self.assertEqual(res.returncode, 0, res.stderr)
        return self.load("run-part.json")

    def test_discover_reads_only_the_store_host(self):
        res = self.discover()
        self.assertEqual(res.returncode, 0, res.stderr)
        data = self.load("pages.json")
        urls = [p["url"] for p in data["pages"]]
        self.assertEqual(urls[0], STORE + "/")
        self.assertEqual(sorted(urls[1:]), sorted([STORE + "/products/ceramic-mug", STORE + "/products/canvas-tote",
                                                   STORE + "/pages/about"]))
        self.assertIn({"url": "sitemap child", "reason": "off-host"}, data["errors"])
        self.assertTrue(all(k.startswith(STORE + "/") for k in data["link_status"]))
        self.assertEqual(data["link_status"][STORE + "/pages/missing"], 404)
        self.assertEqual(data["offhost_images_unchecked"], 1)
        self.assertNotIn("TODO", data["pages"][0]["text"], "script text is not page text")

    def test_discover_page_cap_and_bad_arguments(self):
        self.assertEqual(self.discover("--max-pages", "2").returncode, 0)
        self.assertEqual(len(self.load("pages.json")["pages"]), 2)
        self.assertEqual(run("discover.py", "--store", "http://your-store.com", "--out", self.p("x.json")).returncode, 2)
        self.assertEqual(run("discover.py", "--store", STORE, "--out", self.p("x.json"), "--delay-ms", "10").returncode, 2)
        os.remove(os.path.join(self.store, "sitemap.xml"))
        res = self.discover()
        self.assertEqual(res.returncode, 2)
        self.assertIn("sitemap", res.stderr)

    def test_discover_refuses_entity_declarations(self):
        write(os.path.join(self.store, "sitemap.xml"),
              '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><urlset><url><loc>&a;</loc></url></urlset>')
        self.assertEqual(self.discover().returncode, 2)

    def test_checks_find_the_seeded_problems_and_leave_the_clean_product(self):
        self.assertEqual(self.discover().returncode, 0)
        found = self.checks()
        for expected in [("placeholder_text", "canvas-tote"), ("zero_price", "canvas-tote"),
                         ("compare_at_not_above", "canvas-tote"), ("unavailable_featured", "canvas-tote"),
                         ("missing_alt", "canvas-tote"), ("broken_image", "canvas-tote"),
                         ("missing_meta_description", "canvas-tote"), ("thin_description", "canvas-tote"),
                         ("placeholder_text", "about"), ("broken_link", "home")]:
            self.assertIn(expected, found)
        self.assertFalse([f for f in found if f[1] == "ceramic-mug"], found)
        self.assertNotIn("restricted_wording", {f[0] for f in found})
        issues = self.load("issues.json")["issues"]
        self.assertTrue(all("Lorem" not in i["detail"] for i in issues if i["rule"] != "placeholder_text"))
        order = [i["severity"] for i in issues]
        self.assertEqual(order, sorted(order, key=["high", "medium", "low"].index))

    def test_restricted_wording_runs_only_with_phrases(self):
        make_store(self.store, about_body="Our risk free promise.")
        self.assertEqual(self.discover().returncode, 0)
        self.assertNotIn(("restricted_wording", "about"), self.checks())
        write(self.p("restricted.json"), json.dumps(["risk free"]))
        self.assertIn(("restricted_wording", "about"), self.checks("--restricted", self.p("restricted.json")))

    def test_checks_refuse_an_unknown_rule(self):
        self.assertEqual(self.discover().returncode, 0)
        write(self.p("rules.json"), json.dumps({"rules": [{"id": "made_up", "enabled": True, "severity": "high"}]}))
        res = run("qa_checks.py", "--pages", self.p("pages.json"), "--rules", self.p("rules.json"), "--out", self.p("i.json"))
        self.assertEqual(res.returncode, 2)

    def snapshot_from(self, part):
        """Stores a run's records the way the write step would, keyed by identity."""
        docs = {}
        for r in part["records"]:
            key = r["values"]["id"]
            eid = desk_contract.entity_id(r["type"], key)
            docs[f"entities/{eid}"] = {"version": 1, "data": {"type": r["type"], "key": key,
                                                              "bySource": {PRODUCER: r["values"]}}}
        return docs

    def eid_of(self, docs, issue_id):
        return next(p[len("entities/"):] for p, d in docs.items() if d["data"]["key"] == issue_id)

    def test_track_first_run_then_fixes_and_decisions(self):
        self.assertEqual(self.discover().returncode, 0)
        self.checks()
        first = self.track({})
        states = {r["values"]["state"] for r in first["records"]}
        self.assertEqual(states, {"new"})
        self.assertEqual(first["inbox"][0]["title"].split(":")[0], "High")
        self.assertTrue(all(len(m["title"]) <= 100 for m in first["inbox"]))
        issues = {r["values"]["rule"] + "@" + r["values"]["url"].rsplit("/", 1)[-1]: r["values"]["id"]
                  for r in first["records"] if r["type"] == "issue"}
        links = [r["links"] for r in first["records"] if r["type"] == "issue"]
        self.assertTrue(all(l[0]["type"] == "page" for l in links))

        docs = self.snapshot_from(first)
        docs[f"decisions/{self.eid_of(docs, issues['placeholder_text@canvas-tote'])}"] = {
            "version": 1, "data": {"decision": "keep"}}
        docs[f"decisions/{self.eid_of(docs, issues['zero_price@canvas-tote'])}"] = {
            "version": 1, "data": {"decision": "drop", "reason": "Accepted: free sample variant"}}

        make_store(self.store, tote_description=LONG, about_body="About our studio.")
        self.assertEqual(self.discover().returncode, 0)
        self.checks()
        second = self.track(docs)
        by_id = {r["values"]["id"]: r["values"] for r in second["records"] if r["type"] == "issue"}
        self.assertEqual(by_id[issues["placeholder_text@canvas-tote"]]["state"], "resolved")
        self.assertEqual(by_id[issues["placeholder_text@about"]]["state"], "resolved")
        self.assertEqual(by_id[issues["zero_price@canvas-tote"]]["state"], "open")
        self.assertEqual(second["summary"]["decisions"]["accepted"], 1)
        titles = [m["title"] for m in second["inbox"]]
        self.assertEqual(titles, ["Fixed: Placeholder text left on the page"])
        pages = {r["values"]["url"].rsplit("/", 1)[-1]: r["values"]["state"] for r in second["records"] if r["type"] == "page"}
        self.assertEqual(pages["canvas-tote"], "changed")
        self.assertEqual(pages["ceramic-mug"], "unchanged")

    def test_track_marks_a_page_removed_from_the_sitemap(self):
        self.assertEqual(self.discover().returncode, 0)
        self.checks()
        docs = self.snapshot_from(self.track({}))
        write(os.path.join(self.store, "sitemap_pages_1.xml"),
              '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>')
        self.assertEqual(self.discover().returncode, 0)
        self.checks()
        part = self.track(docs)
        about = [r["values"] for r in part["records"] if r["type"] == "page" and r["values"]["url"].endswith("/about")]
        self.assertEqual(about[0]["state"], "removed")
        self.assertEqual(part["summary"]["pages"]["removed"], 1)
        resolved = [r["values"] for r in part["records"] if r["type"] == "issue" and r["values"]["state"] == "resolved"]
        self.assertTrue(resolved and all(v["url"].endswith("/about") for v in resolved))

    def test_track_caps_the_inbox_and_refuses_bad_input(self):
        self.assertEqual(self.discover().returncode, 0)
        self.checks()
        part = self.track({}, cap="2")
        self.assertEqual(len(part["inbox"]), 2)
        self.assertGreater(part["summary"]["inbox_left_out"], 0)
        res = run("track.py", "--pages", self.p("pages.json"), "--issues", self.p("issues.json"), "--docs",
                  self.p("snapshot.json"), "--producer", PRODUCER, "--max-inbox", "99", "--out", self.p("x.json"))
        self.assertEqual(res.returncode, 2)

    def test_worker_shots_never_fails_the_run(self):
        self.assertEqual(self.discover().returncode, 0)
        self.checks()
        res = run("worker_shots.py", "--worker", "https://127.0.0.1:1", "--issues", self.p("issues.json"),
                  "--max", "3", "--out", self.p("shots.json"))
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(self.load("shots.json"), {"shots": {}, "notes": {}})
        self.assertIsNotNone(json.loads(res.stdout)["error"])
        bad = run("worker_shots.py", "--worker", "http://x.example", "--issues", self.p("issues.json"), "--out", self.p("s.json"))
        self.assertEqual(bad.returncode, 2)

    def first_run_docs(self, *extra):
        self.assertEqual(self.discover(*extra).returncode, 0)
        self.checks()
        return self.snapshot_from(self.track({}))

    def edit_pages(self, change):
        data = self.load("pages.json")
        change(data)
        with open(self.p("pages.json"), "w", encoding="utf-8") as fh:
            json.dump(data, fh)

    def test_transient_failures_never_resolve_issues(self):
        docs = self.first_run_docs()

        def fail_some(data):
            for page in data["pages"]:
                if page["url"].endswith("/about"):
                    for k in ("title", "text", "images", "links", "meta_description"):
                        page.pop(k, None)
                    page.update(status=429, error="rate-limited")
                if page["url"].endswith("/canvas-tote"):
                    page["product"] = {"status": 429}
        self.assertEqual(self.discover().returncode, 0)
        self.edit_pages(fail_some)
        self.checks()
        part = self.track(docs)
        resolved = [r["values"] for r in part["records"] if r["type"] == "issue" and r["values"]["state"] == "resolved"]
        self.assertEqual(resolved, [])
        self.assertFalse([m for m in part["inbox"] if m["title"].startswith("Fixed")])

    def test_a_failed_child_sitemap_removes_nothing(self):
        docs = self.first_run_docs()
        os.remove(os.path.join(self.store, "sitemap_pages_1.xml"))
        self.assertEqual(self.discover().returncode, 0)
        self.assertFalse(self.load("pages.json")["sitemap_complete"])
        self.checks()
        part = self.track(docs)
        self.assertEqual(part["summary"]["pages"]["removed"], 0)
        self.assertFalse([r for r in part["records"] if r["values"].get("state") in ("removed", "resolved")])

    def test_non_ascii_sitemap_urls_are_encoded(self):
        write(os.path.join(self.store, "sitemap_pages_1.xml"),
              f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>{STORE}/pages/über-uns</loc></url>'
              f"<url><loc>{STORE}/products/マグ</loc></url></urlset>")
        res = self.discover()
        self.assertEqual(res.returncode, 0, res.stderr)
        listed = self.load("pages.json")["listed"]
        self.assertIn(STORE + "/pages/%C3%BCber-uns", listed)
        self.assertIn(STORE + "/products/%E3%83%9E%E3%82%B0", listed)

    def test_link_checks_are_sorted_and_image_width_variants_checked_once(self):
        write(os.path.join(self.store, "index.html"),
              page_html("Example store", "Welcome.", links=["/pages/zz-missing", "/pages/aa-missing"],
                        images=[("/cdn/shop/files/a.png?v=1&width=100", "x"), ("/cdn/shop/files/a.png?v=1&width=200", "x")]))
        self.assertEqual(self.discover("--max-link-checks", "3").returncode, 0)
        data = self.load("pages.json")
        crawled = {p["url"] for p in data["pages"]}
        checked = sorted(k for k in data["link_status"] if k not in crawled)
        self.assertEqual(checked, [STORE + "/cdn/shop/files/a.png", STORE + "/files/mug.png", STORE + "/files/tote.png"])
        home = data["pages"][0]
        self.assertEqual([i["src"] for i in home["images"]], [STORE + "/cdn/shop/files/a.png"] * 2)
        self.assertFalse(home["links_complete"])
        self.assertTrue(home["images_complete"])

    def test_a_broken_link_whose_target_was_not_checked_stays_open(self):
        docs = self.first_run_docs()
        self.assertEqual(self.discover("--max-link-checks", "0").returncode, 0)
        self.checks()
        part = self.track(docs)
        resolved = [r["values"]["rule"] for r in part["records"] if r["type"] == "issue" and r["values"]["state"] == "resolved"]
        self.assertNotIn("broken_link", resolved)
        self.assertNotIn("broken_image", resolved)

    def test_the_page_cap_reads_the_least_recently_read_pages_first(self):
        def entity(url, seen):
            pid = track_mod.page_id(url)
            return {"version": 1, "data": {"type": "page", "key": pid, "lastSeen": seen,
                                           "bySource": {PRODUCER: {"url": url, "id": pid}}}}
        docs = {f"entities/x{i}": entity(STORE + u, seen) for i, (u, seen) in enumerate([
            ("/", "2026-11-05T00:00:00Z"), ("/products/ceramic-mug", "2026-11-05T00:00:00Z"),
            ("/products/canvas-tote", "2026-11-01T00:00:00Z")])}
        write(self.p("snapshot.json"), json.dumps(docs))
        res = self.discover("--max-pages", "3", "--docs", self.p("snapshot.json"), "--producer", PRODUCER)
        self.assertEqual(res.returncode, 0, res.stderr)
        urls = [p["url"] for p in self.load("pages.json")["pages"]]
        self.assertEqual(urls, [STORE + "/", STORE + "/pages/about", STORE + "/products/canvas-tote"])

    def test_the_hash_ignores_stock_and_review_counts(self):
        def mug(body, available):
            write(os.path.join(self.store, "products", "ceramic-mug.html"),
                  page_html("Ceramic mug", body, images=[("/files/mug.png", "A white ceramic mug")]))
            write(os.path.join(self.store, "products", "ceramic-mug.js"), json.dumps({
                "available": True, "description": f"<p>{LONG}</p>",
                "variants": [{"price": 1800, "compare_at_price": 2400, "available": available}]}))
            self.assertEqual(self.discover().returncode, 0)
            return next(p["hash"] for p in self.load("pages.json")["pages"] if p["url"].endswith("/ceramic-mug"))
        self.assertEqual(mug("Only 3 left. 12 reviews.", True), mug("Only 2 left. 13 reviews.", False))
        self.assertNotEqual(mug("Only 2 left. 13 reviews.", False), mug("A new story.", False))

    def test_products_json_adds_products_and_saves_product_requests(self):
        feed = {"products": [
            {"handle": "canvas-tote", "body_html": "<p>TODO write this</p>",
             "variants": [{"price": "0.00", "compare_at_price": None, "available": False}]},
            {"handle": "linen-apron", "body_html": f"<p>{LONG}</p>",
             "variants": [{"price": "25.00", "compare_at_price": "30.00", "available": True}]}]}
        write(os.path.join(self.store, "products.json?limit=250&page=1"), json.dumps(feed))
        write(os.path.join(self.store, "products.json?limit=250&page=2"), json.dumps({"products": []}))
        write(os.path.join(self.store, "products", "linen-apron.html"), page_html("Linen apron", "Our apron."))
        os.remove(os.path.join(self.store, "products", "canvas-tote.js"))
        res = self.discover()
        self.assertEqual(res.returncode, 0, res.stderr)
        data = self.load("pages.json")
        self.assertIn(STORE + "/products/linen-apron", data["listed"])
        self.assertEqual(data["products_json"], {"status": "ok", "pages": 2, "products": 2})
        self.assertTrue(data["sitemap_complete"])
        tote = next(p for p in data["pages"] if p["url"].endswith("/canvas-tote"))
        self.assertEqual((tote["product"]["status"], tote["product"]["source"]), (200, "products.json"))
        found = self.checks()
        self.assertIn(("zero_price", "canvas-tote"), found)
        self.assertNotIn(("page_error", "canvas-tote"), found)

    def test_a_store_without_products_json_uses_the_sitemap_only(self):
        res = self.discover()
        self.assertEqual(res.returncode, 0, res.stderr)
        data = self.load("pages.json")
        self.assertEqual(data["products_json"]["status"], "unavailable")
        self.assertTrue(data["sitemap_complete"])
        self.assertEqual(data["errors"], [{"url": "sitemap child", "reason": "off-host"}])

    def test_worker_connector_covers_discover_and_the_prompt_quotes_values(self):
        p = pack.export(FOLDER)
        worker = next(c for c in p["connectors"] if c["id"] == "worker")
        self.assertIn("discover", worker["stages"])
        prompt = read("prompt.md")
        self.assertIn('--store "STORE"', prompt)
        self.assertIn('--via "WORKER"', prompt)
        self.assertIn('--docs snapshot.json --producer shopify-content-qa', prompt)
        self.assertNotIn("The routine does not use it", read("README.md"))


H = "https://your-store.com"
qa_mod = lib_module("qa_checks")


class FakeResponse:
    def __init__(self, status, body):
        self.status, self._body = status, body

    def read(self, n=-1):
        return self._body if n is None or n < 0 else self._body[:n]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeOpener:
    """Answers by full request URL with (status, headers, body); a list answers in turn. Records every URL."""

    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def open(self, req, timeout=None):
        url = req.full_url
        self.calls.append(url)
        ans = self.routes.get(url, (404, {}, b""))
        if isinstance(ans, list):
            ans = ans.pop(0) if len(ans) > 1 else ans[0]
        status, headers, body = ans
        if status >= 300:
            raise urllib.error.HTTPError(url, status, "x", headers, io.BytesIO(body))
        return FakeResponse(status, body)


def fetcher(routes, via=None):
    f = discover_mod.Fetcher("your-store.com", 0, via)
    f.opener = FakeOpener(routes)
    return f


class FetcherTests(unittest.TestCase):
    def test_follows_a_same_host_redirect(self):
        f = fetcher({H + "/old": (301, {"Location": "/new"}, b""), H + "/new": (200, {}, b"ok")})
        self.assertEqual(f.get(H + "/old"), (200, "ok", None))
        self.assertEqual(f.final_url, H + "/new")

    def test_does_not_follow_a_redirect_to_another_host_and_names_it(self):
        f = fetcher({H + "/": (301, {"Location": "https://www.your-store.com/"}, b"")})
        self.assertEqual(f.get(H + "/"), (301, None, "redirect-off-host"))
        self.assertEqual(f.redirect_location, "https://www.your-store.com/")
        self.assertEqual(f.opener.calls, [H + "/"])

    def test_waits_retry_after_once_then_records_rate_limited(self):
        f = fetcher({H + "/a": [(429, {"Retry-After": "7"}, b""), (200, {}, b"ok")],
                     H + "/b": (429, {"Retry-After": "99"}, b"")})
        with mock.patch.object(discover_mod.time, "sleep") as sleep:
            self.assertEqual(f.get(H + "/a"), (200, "ok", None))
            self.assertIn(mock.call(7.0), sleep.call_args_list)
            self.assertEqual(f.get(H + "/b"), (429, None, "rate-limited"))
            self.assertIn(mock.call(30.0), sleep.call_args_list)

    def test_too_large_and_off_host(self):
        f = fetcher({H + "/big": (200, {}, b"x" * 11)})
        self.assertEqual(f.get(H + "/big", limit=10), (200, None, "too-large"))
        self.assertEqual(f.get("https://other.example/"), (0, None, "off-host"))
        self.assertEqual(f.get("http://your-store.com/"), (0, None, "off-host"))
        self.assertEqual(f.opener.calls, [H + "/big"])

    def test_via_sends_every_request_through_the_worker(self):
        via = "https://qa.example.workers.dev"
        f = fetcher({via + "/fetch?url=" + urllib.parse.quote(H + "/a", safe=""): (200, {}, b"ok")}, via=via)
        self.assertEqual(f.get(H + "/a"), (200, "ok", None))

    def test_non_ascii_url_is_percent_encoded_not_raised(self):
        f = fetcher({H + "/products/%E3%83%9E%E3%82%B0": (200, {}, b"ok")})
        self.assertEqual(f.get(H + "/products/マグ"), (200, "ok", None))


class StoreAddress(unittest.TestCase):
    def run_discover(self, routes):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as cm:
            discover_mod.discover(fetcher(routes), H, 10, 10)
        self.assertEqual(cm.exception.code, 2)
        return err.getvalue()

    def test_a_store_that_redirects_to_another_host_names_the_host_to_use(self):
        msg = self.run_discover({H + "/": (301, {"Location": "https://www.your-store.com/"}, b"")})
        self.assertIn("store redirects to https://www.your-store.com; set store_url to that", msg)

    def test_a_password_protected_store_says_so(self):
        msg = self.run_discover({H + "/": (302, {"Location": "/password"}, b""), H + "/password": (200, {}, b"<html></html>")})
        self.assertIn("password protected", msg)


class Parsing(unittest.TestCase):
    def parse(self, html):
        p = discover_mod.PageParser()
        p.feed(html)
        return p

    def test_title_ignores_svg_titles_and_stops_at_the_first_close(self):
        p = self.parse("<html><head><title>Shop</title></head><body><svg><title>Cart</title></svg>"
                       "<title>Later</title></body></html>")
        self.assertEqual(p.title, "Shop")
        self.assertEqual(self.parse("<body><svg><title>Icon</title></svg></body>").title, None)

    def test_noscript_images_are_not_counted(self):
        p = self.parse('<img src="/a.png" alt=""><noscript><img src="/a.png"></noscript>')
        self.assertEqual(p.images, [{"src": "/a.png", "alt": ""}])

    def test_canonical_percent_encodes_and_survives_bad_urls(self):
        self.assertEqual(discover_mod.canonical(H + "/pages/über", "your-store.com"), H + "/pages/%C3%BCber")
        self.assertEqual(discover_mod.canonical(H + "/pages/%C3%BCber", "your-store.com"), H + "/pages/%C3%BCber")
        self.assertIsNone(discover_mod.canonical("https://[bad/x", "your-store.com"))


def one_page(url, **over):
    page = {"url": url, "kind": "product", "status": 200, "title": "T", "meta_description": "m", "text": "",
            "images": [], "links": [], "product": {"status": 200, "description_words": 50,
                                                   "description_text": "w " * 50, "variants": []}}
    page.update(over)
    return page


class Rules(unittest.TestCase):
    def rules(self):
        with open(os.path.join(LIB, "rules.json"), encoding="utf-8") as fh:
            return qa_mod.load_rules(json.load(fh))

    def found(self, page):
        return {i["rule"]: i for i in qa_mod.check({"pages": [page]}, self.rules())["issues"]}

    def test_empty_alt_is_decorative_and_not_missing(self):
        found = self.found(one_page(H + "/products/a", images=[{"src": H + "/a.png", "alt": ""}]))
        self.assertNotIn("missing_alt", found)
        found = self.found(one_page(H + "/products/a", images=[{"src": H + "/a.png", "alt": None},
                                                               {"src": H + "/b.png", "alt": ""}]))
        self.assertEqual(found["missing_alt"]["detail"], "1 of 2 images have no alt attribute")

    def test_thin_description_counts_characters_in_scripts_without_spaces(self):
        rules = json.loads(read("lib/rules.json"))
        params = next(r for r in rules["rules"] if r["id"] == "thin_description")["params"]
        self.assertEqual(params["min_chars"], 60)
        long_text = "一" * 80
        page = one_page(H + "/products/a", product={"status": 200, "description_words": 1,
                                                    "description_text": long_text, "variants": []})
        self.assertNotIn("thin_description", self.found(page))
        page["product"]["description_text"] = "ก" * 20
        self.assertIn("20 characters, under 60", self.found(page)["thin_description"]["detail"])
        page["product"]["description_text"] = "short words only"
        page["product"]["description_words"] = 3
        self.assertIn("3 words, under 30", self.found(page)["thin_description"]["detail"])


class Tracking(unittest.TestCase):
    def test_pages_get_a_hashed_id_that_never_collides_on_slugs(self):
        a, b = H + "/products/blue_mug", H + "/products/blue-mug"
        out = track_mod.track({"pages": [one_page(a), one_page(b)], "listed": [a, b], "sitemap_complete": True},
                              {"issues": [{"id": "x--1", "rule": "zero_price", "severity": "high", "url": a}]},
                              {}, PRODUCER, 10, {})
        pages = [r["values"] for r in out["records"] if r["type"] == "page"]
        ids = [p["id"] for p in pages]
        self.assertRegex(ids[0], r"^page--[0-9a-f]{12}$")
        self.assertEqual(len({desk_contract.entity_id("page", i) for i in ids}), 2)
        issue = next(r for r in out["records"] if r["type"] == "issue")
        self.assertEqual(issue["links"], [{"type": "page", "key": ids[0]}])
        d = json.loads(read("definition.json"))
        self.assertEqual(d["types"]["page"]["identity"], "field:id")
        self.assertIn("id", d["types"]["page"]["fields"])
        self.assertIn("screenshot_note", d["types"]["issue"]["fields"])

    def test_screenshot_notes_reach_the_issue_record(self):
        a = H + "/products/a"
        shots = {"shots": {a: "https://qa.example.workers.dev/shot/x"}, "notes": {a: "image overlaps text"}}
        out = track_mod.track({"pages": [one_page(a)], "listed": [a], "sitemap_complete": True},
                              {"issues": [{"id": "x--1", "rule": "zero_price", "severity": "high", "url": a}]},
                              {}, PRODUCER, 10, shots)
        issue = next(r["values"] for r in out["records"] if r["type"] == "issue")
        self.assertEqual(issue["screenshot"], "https://qa.example.workers.dev/shot/x")
        self.assertEqual(issue["screenshot_note"], "image overlaps text")


class WorkerShots(unittest.TestCase):
    def test_enqueues_high_and_medium_pages_and_keeps_https_links_and_notes(self):
        calls = []

        def fake(url, body=None):
            calls.append((url, body))
            if url.endswith("/enqueue"):
                return {"queued": 2}
            return {"shots": {H + "/a": "https://qa.example.workers.dev/shot/1", H + "/b": "http://plain.example/x",
                              H + "/c": 5}, "notes": {H + "/a": "none", H + "/b": 3}}

        issues = [{"severity": "high", "url": H + "/a"}, {"severity": "medium", "url": H + "/b"},
                  {"severity": "high", "url": H + "/a"}, {"severity": "low", "url": H + "/c"},
                  {"severity": "medium", "url": H + "/d"}]
        shots, notes, status = shots_mod.collect("https://qa.example.workers.dev", issues, 2, fake)
        self.assertEqual(calls[0], ("https://qa.example.workers.dev/enqueue", {"urls": [H + "/a", H + "/b"]}))
        self.assertEqual(calls[1], ("https://qa.example.workers.dev/shots", None))
        self.assertEqual(shots, {H + "/a": "https://qa.example.workers.dev/shot/1"})
        self.assertEqual(notes, {H + "/a": "none"})
        self.assertEqual((status["queued"], status["links"], status["error"]), (2, 1, None))

    def test_main_writes_links_and_notes(self):
        with tempfile.TemporaryDirectory() as d:
            issues, out = os.path.join(d, "issues.json"), os.path.join(d, "shots.json")
            write(issues, json.dumps({"issues": [{"severity": "high", "url": H + "/a"}]}))
            fake = lambda url, body=None: ({"queued": 1} if body else
                                           {"shots": {H + "/a": "https://w.example/shot/1"}, "notes": {H + "/a": "ok"}})
            argv = ["worker_shots.py", "--worker", "https://w.example", "--issues", issues, "--out", out]
            with mock.patch.object(shots_mod, "call", fake), mock.patch.object(sys, "argv", argv), \
                    contextlib.redirect_stdout(io.StringIO()):
                shots_mod.main()
            with open(out, encoding="utf-8") as fh:
                self.assertEqual(json.load(fh), {"shots": {H + "/a": "https://w.example/shot/1"}, "notes": {H + "/a": "ok"}})


class ProductFeed(unittest.TestCase):
    def feed_url(self, n):
        return f"{H}/products.json?limit=250&page={n}"

    def body(self, *handles):
        return json.dumps({"products": [{"handle": h, "body_html": "<p>Words here</p>",
                                         "variants": [{"price": "10.00", "compare_at_price": None, "available": True}]}
                                        for h in handles]}).encode()

    def test_pages_until_empty(self):
        f = fetcher({self.feed_url(1): (200, {}, self.body("a", "b")), self.feed_url(2): (200, {}, self.body())})
        products, status = discover_mod.product_feed(f, "your-store.com")
        self.assertEqual(status, {"status": "ok", "pages": 2, "products": 2})
        self.assertEqual(products[H + "/products/a"]["status"], 200)
        self.assertEqual(products[H + "/products/a"]["source"], "products.json")
        self.assertTrue(products[H + "/products/a"]["available"])

    def test_disabled_feed_is_unavailable_not_an_error(self):
        products, status = discover_mod.product_feed(fetcher({}), "your-store.com")
        self.assertEqual((products, status["status"]), ({}, "unavailable"))

    def test_failure_after_the_first_page_is_partial_and_the_cap_holds(self):
        f = fetcher({self.feed_url(1): (200, {}, self.body("a")), self.feed_url(2): (500, {}, b"")})
        self.assertEqual(discover_mod.product_feed(f, "your-store.com")[1]["status"], "partial")
        routes = {self.feed_url(n): (200, {}, self.body(f"p{n}")) for n in range(1, discover_mod.MAX_PRODUCT_PAGES + 3)}
        f = fetcher(routes)
        products, status = discover_mod.product_feed(f, "your-store.com")
        self.assertEqual(status["status"], "capped")
        self.assertEqual(len(f.opener.calls), discover_mod.MAX_PRODUCT_PAGES)


if __name__ == "__main__":
    unittest.main()
