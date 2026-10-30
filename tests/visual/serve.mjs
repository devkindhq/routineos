// Tiny static server for the Desk visual checks (node http only, no dependencies).
// GET /desk.html?store=static&snapshot=/snap/demo.json&workspace=Name serves the bundled Desk with its
// desk-config block replaced from the query. GET /snap/<name>.json serves a fixture built from the
// committed demo snapshot. GET /snap/slow.json never answers, so the loading state stays on screen.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DESK = join(ROOT, "skills", "routineos", "assets", "desk", "index.html");
const DEMO = join(ROOT, "templates", "jobs-watch", "demo", "desk-demo.json");
const CONFIG_RE = /(<script type="application\/json" id="desk-config">)([\s\S]*?)(<\/script>)/;
export const HOSTILE = "<img src=x onerror=alert(1)>";
export const HOSTILE_ID = "role--https-jobs-example-nz-hostile";

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
    demo, empty: {}, "first-run": meta, hostile,
    "perf-1000": scaled(demo, 1000), "perf-5000": scaled(demo, 5000),
  };
}

function deskPage(params) {
  const cfg = { store: params.get("store") || "static" };
  if (params.get("snapshot")) cfg.snapshot = params.get("snapshot");
  if (params.get("workspace")) cfg.workspace = params.get("workspace");
  // JSON inside a script element: escape "<" so a config value cannot close the element.
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
  return readFileSync(DESK, "utf8").replace(CONFIG_RE, (_m, a, _b, c) => a + json + c);
}

export function start(port = 0) {
  const snaps = Object.fromEntries(Object.entries(fixtures()).map(([k, v]) => [k, JSON.stringify(v)]));
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname === "/desk.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(deskPage(url.searchParams));
        return;
      }
      const m = url.pathname.match(/^\/snap\/([a-z0-9-]+)\.json$/);
      if (m && m[1] === "slow") return;
      if (m && m[1] in snaps) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(snaps[m[1]]);
        return;
      }
    } catch (e) {
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
