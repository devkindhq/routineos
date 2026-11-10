"""A second workspace started from the jobs-watch template: same Desk, own definition copy, own settings, own data."""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "skills", "routineos", "scripts")
CLI = os.path.join(SCRIPTS, "routineos.py")
TEMPLATE = os.path.join(ROOT, "templates", "jobs-watch")
DESK = os.path.join(ROOT, "skills", "routineos", "assets", "desk", "index.html")
DEMO = os.path.join(ROOT, "templates", "jobs-watch", "demo", "desk-demo.json")
sys.path.insert(0, SCRIPTS)

import bundle_desk  # noqa: E402
import desk_contract as dc  # noqa: E402

NAME = "jobs-nz"
AT = "2026-10-29T09:00:00Z"
MARKETS = '["NZ"]'
KEYWORDS = '["Shopify", "Hydrogen"]'
COMPANIES = [("Kauri Commerce", "kauri-commerce.example"), ("Tui Labs", "tui-labs.example"),
             ("Harbour Goods", "harbour-goods.example"), ("Ponga Retail", "ponga-retail.example")]
TITLES = ["Shopify developer", "Senior Shopify engineer", "Hydrogen developer", "Shopify Plus lead",
          "Hydrogen storefront engineer"]
CITIES = ["Auckland", "Wellington", "Christchurch"]


def cli(*args):
    r = subprocess.run([sys.executable, CLI, *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise AssertionError(" ".join(args[:1]) + ": " + r.stdout + r.stderr)
    return r.stdout


def set_default(toml, name, value):
    """Replace one [[setting]]'s default line, the only edit a person makes to start their own watch."""
    pattern = r'(name = "' + name + r'"[^\[]*?^default = )[^\n]*$'
    out, n = re.subn(pattern, lambda m: m.group(1) + value, toml, count=1, flags=re.M | re.S)
    assert n == 1, name
    return out


def nz_run():
    """One synthetic run: 10 NZ roles across 4 companies, plus 2 AU roles the NZ-only setting drops."""
    records = [{"type": "company", "key": d, "values": {"name": n, "domain": d, "industry": "Retail",
                                                       "size": 20 + 10 * i, "country": "NZ"}}
               for i, (n, d) in enumerate(COMPANIES)]
    for i in range(12):
        name, domain = COMPANIES[i % len(COMPANIES)]
        market = "AU" if i >= 10 else "NZ"
        records.append({"type": "role", "links": [{"type": "company", "key": domain}], "values": {
            "title": TITLES[i % len(TITLES)], "company": name, "company_domain": domain, "market": market,
            "location": "Sydney" if market == "AU" else CITIES[i % len(CITIES)], "remote": i % 3 == 0,
            "salary_max": 120000 + 5000 * i, "posted": f"2026-10-{20 + i % 8:02d}",
            "url": f"https://jobs-nz.example/{market.lower()}/{i + 1:03d}", "seniority": "mid"}})
    return {"runId": "jobs-nz-20261029", "producer": NAME, "startedAt": "2026-10-29T22:00:00Z",
            "endedAt": "2026-10-29T22:06:00Z", "status": "ok", "claimed": 1, "parsed": 1, "records": records}


def read_batches(d):
    out = []
    for name in sorted(os.listdir(d)):
        with open(os.path.join(d, name), encoding="utf-8") as fh:
            out.append(json.load(fh))
    return out


def build(base):
    """Scaffold, set NZ settings, seed, then plan one run. Returns (workspace dir, seed batches, run batches)."""
    ws = os.path.join(base, NAME)
    cli("new", NAME, "--from-template", "jobs-watch", "--dir", ws)
    path = os.path.join(ws, "routine.toml")
    with open(path, encoding="utf-8") as fh:
        toml = fh.read()
    toml = set_default(set_default(toml, "markets", MARKETS), "title_keywords", KEYWORDS)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(toml)
    cli("lint", ws)
    cli("seed", ws, "--out", os.path.join(base, "seed"), "--at", AT)
    seed = read_batches(os.path.join(base, "seed"))
    store = dc.FakeStore()
    for b in seed:
        store.apply(b["writes"])
    with open(os.path.join(base, "docs.json"), "w", encoding="utf-8") as fh:
        json.dump(store.snapshot(), fh)
    with open(os.path.join(base, "run.json"), "w", encoding="utf-8") as fh:
        json.dump(nz_run(), fh)
    cli("write", "--docs", os.path.join(base, "docs.json"), "--run", os.path.join(base, "run.json"),
        "--out", os.path.join(base, "run"))
    return ws, seed, read_batches(os.path.join(base, "run"))


class SecondWorkspaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.ws, cls.seed, cls.run_batches = build(cls.tmp.name)
        cls.store = dc.FakeStore()
        for b in cls.seed:
            cls.store.apply(b["writes"])
        cls.after_seed = cls.store.snapshot()
        for b in cls.run_batches:
            dc.guard(b["writes"])
            cls.store.apply(b["writes"])
        cls.snap = cls.store.snapshot()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def file(self, *parts):
        with open(os.path.join(*parts), encoding="utf-8") as fh:
            return fh.read()

    def test_files_match_the_template_except_name_and_settings(self):
        self.assertEqual(self.file(self.ws, "definition.json"), self.file(TEMPLATE, "definition.json"))
        for f in ("prompt.md", "README.md"):
            self.assertEqual(self.file(self.ws, f), self.file(TEMPLATE, f), f)
        ours = self.file(self.ws, "routine.toml").splitlines()
        theirs = self.file(TEMPLATE, "routine.toml").splitlines()
        self.assertEqual(len(ours), len(theirs))
        changed = [(a, b) for a, b in zip(theirs, ours) if a != b]
        self.assertEqual(changed, [
            ('name = "jobs-watch"', f'name = "{NAME}"'),
            ('default = ["AU", "US", "CA", "NZ", "PH"]', f"default = {MARKETS}"),
            ('default = ["Shopify", "headless", "commerce", "AI automation"]', f"default = {KEYWORDS}"),
        ])

    def test_dashboard_is_the_bundled_desk_with_its_own_config(self):
        config = re.compile(r'(<script type="application/json" id="desk-config">)(.*?)(</script>)', re.S)
        page = self.file(self.ws, "dashboard", "index.html")
        desk = self.file(DESK).replace(bundle_desk.VERSION_MARK, bundle_desk.plugin_version())
        self.assertEqual(config.sub("", page), config.sub("", desk))
        m = config.search(page)
        if m is None:
            self.fail("desk-config block missing")
        self.assertEqual(json.loads(m.group(2)), {"store": "db", "workspace": NAME})

    def test_seed_is_first_run_state_with_template_provenance(self):
        paths = set(self.after_seed)
        self.assertFalse([p for p in paths if p.startswith(("runs/", "entities/", "inbox/"))], paths)
        ws = self.after_seed["meta/workspace"]["data"]
        self.assertEqual((ws["name"], ws["template"], ws["templateVersion"]), (NAME, "jobs-watch", 1))
        self.assertTrue(ws["lint"]["ok"], ws["lint"])
        values = self.after_seed[f"settings/{NAME}"]["data"]["values"]
        self.assertEqual((values["markets"], values["title_keywords"]), (["NZ"], ["Shopify", "Hydrogen"]))

    def test_run_keeps_nz_roles_and_drops_the_rest_by_setting(self):
        roles = [d["data"] for p, d in self.snap.items() if p.startswith("entities/role--")]
        active = [r for r in roles if r["status"] == "active"]
        dropped = [r for r in roles if r["status"] == "dropped"]
        self.assertEqual(len(active), 10)
        self.assertTrue(all(r["display"]["market"] == "NZ" for r in active))
        self.assertEqual([(r["display"]["market"], r["dropReason"]) for r in dropped], [("AU", "not in markets")] * 2)
        run = self.snap["runs/jobs-nz-20261029"]["data"]
        self.assertEqual((run["phase"], run["producer"]), ("done", NAME))
        self.assertEqual(run["settingsUsed"]["markets"], ["NZ"])

    def test_data_is_synthetic_and_shares_nothing_with_the_demo(self):
        for path, doc in self.snap.items():
            if not path.startswith("entities/"):
                continue
            for field, value in doc["data"]["display"].items():
                if field.endswith("domain"):
                    self.assertTrue(value.endswith(".example"), (path, value))
                if isinstance(value, str) and value.startswith(("http://", "https://")):
                    self.assertTrue((urlparse(value).hostname or "").endswith(".example"), (path, value))
        with open(DEMO, encoding="utf-8") as fh:
            demo = json.load(fh)
        shared = {p for p in self.snap if p.startswith(("entities/", "runs/", "inbox/"))} & set(demo)
        self.assertEqual(shared, set())

    def test_definition_matches_the_demo_types(self):
        with open(DEMO, encoding="utf-8") as fh:
            demo_types = json.load(fh)["meta/definition"]["data"]["types"]
        ours = self.snap["meta/definition"]["data"]["types"]
        for tname in ("company", "role"):
            self.assertEqual(ours[tname]["fields"], demo_types[tname]["fields"], tname)


if __name__ == "__main__":
    unittest.main()
