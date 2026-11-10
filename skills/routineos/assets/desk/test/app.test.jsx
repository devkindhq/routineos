import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import App from "../app/App.jsx";
import { createStore } from "../core/store.js";

test("App mounts Mantine and shows the page title", async () => {
  window.history.replaceState(null, "", "#/today");
  var store = createStore("static", { docs: { "meta/definition": { data: { types: {} } } } });
  render(<App store={store} config={{ workspace: "W" }} />);
  const title = await screen.findByRole("heading", { level: 1, name: "Today" });
  expect(title.id).toBe("page-title");
});

// Every page and Settings section takes its write context from usePageCtx (app/StoreContext.jsx), so a gate that
// reads join and owner (canDecide) sees the same fields everywhere. A page that builds its own {store, viewer} fails.
test("no page builds its own write context", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const app = join(__dirname, "..", "app");
  const files = [];
  (function walk(d) {
    readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.jsx?$/.test(e.name)) files.push(p);
    });
  })(app);
  const own = files.filter((p) => /ctx\s*=\s*(useMemo\(\s*\(\)\s*=>\s*\(\s*)?\{\s*store\s*:/.test(readFileSync(p, "utf8")));
  expect(own.map((p) => p.slice(app.length + 1))).toEqual([]);
});
