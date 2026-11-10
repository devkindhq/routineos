// Tiny static server for the Desk visual checks (node http only, no dependencies).
// GET /desk.html?store=static&snapshot=/snap/demo.json&workspace=Name serves the committed Vite build
// (skills/routineos/assets/desk/index.html, injected by bundle_desk.inject as routineos.desk_page does) with its
// desk-config block replaced from the query. GET /snap/<name>.json serves a fixture built from the
// committed demo snapshot; /snap/weekly.json serves the weekly marketing report demo; /snap/v2.json, /snap/walk.json and /snap/lock.json serve the generated v2 fixtures
// (tests/desk_fixtures/make_v2_demo.py). GET /snap/slow.json never answers, so the loading state stays on screen.
// &bundle=desk serves the page with the salary-band field cell component injected, for the `desk` snapshot;
// &bundle=bad-components adds BAD_COMPONENTS to it. &tour=1 sets the tour config key (spec 7f).
// There is one page: the split build, its lazy pages and the CDN mirror are gone.
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DEMO = join(ROOT, "templates", "jobs-watch", "demo", "desk-demo.json");
const V2 = join(ROOT, "tests", "desk_fixtures", "v2-demo.json");
const WALK = join(ROOT, "tests", "desk_fixtures", "v2-walk.json");
const LOCK = join(ROOT, "tests", "desk_fixtures", "lock-demo.json");
const TWIN = join(ROOT, "tests", "desk_fixtures", "preview-twin.json");
const WEEKLY = join(ROOT, "templates", "weekly-marketing-report", "demo", "pages-demo.json");
const CONFIG_RE = /(<script type="application\/json" id="desk-config">)([\s\S]*?)(<\/script>)/;
const SCRIPTS = join(ROOT, "skills", "routineos", "scripts");
const EXT_DIR = join(ROOT, "tests", "desk_fixtures", "ext");
const SALARY_BAND = join(ROOT, "tests", "desk_fixtures", "components", "good", "salary-band", "salary-band.js");
// The page the specs open. There is one bundle mode now; DESK_BUNDLE is ignored.
export function deskUrl(origin, query, hash = "") {
  return origin + "/desk.html?" + query + hash;
}
export const HOSTILE = "<img src=x onerror=alert(1)>";
// The desk snapshot's view module: Roles from one source, with the salary band column drawn by its component.
export const DESK_MODULE = { id: "senior-pay", kind: "view", label: "Senior pay", producer: "jobs-watch",
  view: { type: "role", filters: { source: ["jobs-watch"] }, columns: ["title", "salary_band", "lastSeen"] },
  fields: { salary_band: "salary-band" } };

// The demo plus a desk block with one view module, and a salary_band field {min, max} on every role that has a max.
function withDesk(demo) {
  const out = JSON.parse(JSON.stringify(demo));
  const def = out["meta/definition"].data;
  def.types.role.fields.salary_band = { label: "Salary band", type: "text" };
  def.desk = { modules: [DESK_MODULE] };
  for (const [path, doc] of Object.entries(out)) {
    const d = doc.data && doc.data.display;
    if (!path.startsWith("entities/role--") || !d || typeof d.salary_max !== "number") continue;
    d.salary_band = { min: d.salary_max - 30000, max: d.salary_max };
    if (doc.data.bySource && doc.data.bySource["jobs-watch"]) doc.data.bySource["jobs-watch"].salary_band = d.salary_band;
  }
  return out;
}

// Two components the lint would refuse, bundled straight past it: one that does not parse and one that redeclares
// a core name at its top level. Each must cost only itself.
export const BAD_COMPONENTS = [
  ["broken-one", "component_broken_one", "function component_broken_one(ctx, props, ui) {\n  return (;\n}\n"],
  ["shadow-el", "component_shadow_el", "function component_shadow_el(ctx, props, ui) { return null; }\nconst el = 1;\nvar renderBrowse = 0;\n"],
];

// The committed page with its version filled in and `components` ([id, factory, text]) injected, through the same
// bundle_desk.inject that routineos.desk_page uses. The components skip the routine lint on purpose, so the bad ones
// reach the page.
function injected(components) {
  const py = "import json, sys; sys.path.insert(0, sys.argv[1]); import bundle_desk as b; " +
    "html = open(b.HTML, encoding='utf-8').read(); " +
    "sys.stdout.write(b.inject(html, {'store': 'static'}, b.plugin_version(), " +
    "[b.component_js(*c) for c in json.loads(sys.argv[2])]))";
  return execFileSync("python3", ["-c", py, SCRIPTS, JSON.stringify(components)],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

// The page with the salary-band fixture component (and `extra` components).
function deskBundle(extra = []) {
  return injected([["salary-band", "component_salary_band", readFileSync(SALARY_BAND, "utf8")], ...extra]);
}
// The page with the agent-written extensions in tests/desk_fixtures/ext (a record section, a panel and a page).
function extBundle() {
  const comps = readdirSync(EXT_DIR).sort().map((id) => {
    const meta = JSON.parse(readFileSync(join(EXT_DIR, id, "component.json"), "utf8"));
    return [id, meta.factory, readFileSync(join(EXT_DIR, id, id + ".js"), "utf8"), meta];
  });
  return injected(comps);
}
export const HOSTILE_ID = "role--https-jobs-example-nz-hostile";

// Text bodies go out gzipped when the client accepts it, as a real host does; `cache` marks files that never
// change within a run. Without this the phone timing measures uncompressed bytes over the throttled link.
const GZIP = /^(text\/|application\/json|image\/svg)/;
function send(req, res, type, body, cache) {
  const headers = { "content-type": type };
  if (cache) headers["cache-control"] = "public, max-age=3600";
  if (GZIP.test(type) && body.length > 1024 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    body = gzipSync(body);
    headers["content-encoding"] = "gzip";
    headers.vary = "accept-encoding";
  }
  headers["content-length"] = Buffer.byteLength(body);
  res.writeHead(200, headers);
  res.end(body);
}

// The demo with every role replaced by n copies of one role, for the Browse timings.
function scaled(demo, n) {
  const out = {};
  let template = null;
  for (const [path, doc] of Object.entries(demo)) {
    if (path.startsWith("entities/role--")) template = template || doc;
    else out[path] = doc;
  }
  for (let i = 0; i < n; i++) {
    const key = "https://jobs.example/perf/" + String(i).padStart(5, "0");
    const markets = ["AU", "US", "CA", "NZ", "PH"];
    const display = Object.assign({}, template.data.display, { url: key, market: markets[i % 5], title: "Shopify developer " + i });
    out["entities/role--https-jobs-example-perf-" + String(i).padStart(5, "0")] = {
      version: 1, data: Object.assign({}, template.data, { key, display, bySource: { "jobs-watch": display } }),
    };
  }
  return out;
}

// The v2 fixture cut to its first n records, so the phone timing measures the build and not a 1.3 MB snapshot.
function smallV2(doc, n) {
  const out = {};
  let kept = 0;
  for (const [path, d] of Object.entries(doc)) {
    if (path.startsWith("entities/") && kept++ >= n) continue;
    out[path] = d;
  }
  return out;
}

export function fixtures() {
  const demo = JSON.parse(readFileSync(DEMO, "utf8"));
  const meta = Object.fromEntries(Object.entries(demo).filter(([p]) => p.startsWith("meta/") || p.startsWith("settings/")));
  const hostile = Object.assign({}, demo);
  const base = demo["entities/role--https-jobs-example-au-00003"];
  const display = Object.assign({}, base.data.display, { title: HOSTILE, company: HOSTILE, url: "https://jobs.example/nz/hostile", market: "NZ" });
  hostile["entities/" + HOSTILE_ID] = {
    version: 1,
    data: Object.assign({}, base.data, { key: display.url, display, bySource: { "jobs-watch": display }, firstSeen: "2026-10-28T22:00:00Z" }),
  };
  return {
    demo, empty: {}, "first-run": meta, hostile, desk: withDesk(demo),
    "perf-1000": scaled(demo, 1000), "perf-5000": scaled(demo, 5000),
    v2: JSON.parse(readFileSync(V2, "utf8")), phone: smallV2(JSON.parse(readFileSync(V2, "utf8")), 40), lock: JSON.parse(readFileSync(LOCK, "utf8")), walk: JSON.parse(readFileSync(WALK, "utf8")),
    "preview-twin": JSON.parse(readFileSync(TWIN, "utf8")), weekly: JSON.parse(readFileSync(WEEKLY, "utf8")),
  };
}

function deskPage(params, custom, plain, ext) {
  const cfg = { store: params.get("store") || "static" };
  if (params.get("snapshot")) cfg.snapshot = params.get("snapshot");
  if (params.get("workspace")) cfg.workspace = params.get("workspace");
  if (params.get("components")) cfg.components = params.get("components");
  if (params.get("tour")) cfg.tour = params.get("tour") === "1";
  // JSON inside a script element: escape "<" so a config value cannot close the element.
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
  const bundle = params.get("bundle");
  const html = bundle === "ext" ? ext() : bundle === "desk" ? custom() : bundle === "bad-components" ? custom(true) : plain();
  return html.replace(CONFIG_RE, (_m, a, _b, c) => a + json + c);
}

export function start(port = 0) {
  const snaps = Object.fromEntries(Object.entries(fixtures()).map(([k, v]) => [k, JSON.stringify(v)]));
  const built = {};
  const custom = (bad) => (built[!!bad] = built[!!bad] || deskBundle(bad ? BAD_COMPONENTS : []));
  const ext = () => (built.ext = built.ext || extBundle());
  const plain = () => (built.plain = built.plain || injected([]));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname === "/desk.html") {
        send(req, res, "text/html; charset=utf-8", Buffer.from(deskPage(url.searchParams, custom, plain, ext)));
        return;
      }
      const m = url.pathname.match(/^\/snap\/([a-z0-9-]+)\.json$/);
      if (m && m[1] === "slow") return;
      if (m && m[1] in snaps) {
        send(req, res, "application/json", Buffer.from(snaps[m[1]]));
        return;
      }
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(e));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await start(Number(process.env.PORT || 4173));
  console.log("serving on http://127.0.0.1:" + server.address().port);
}
