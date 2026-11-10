// node --test tests/visual/serve.test.mjs  (built-in runner, no packages)
// The visual harness serves the committed Vite page (desk/index.html) through bundle_desk.inject, as
// routineos.desk_page does, and the component variant with the fixture components injected before the app script.
import { test } from "node:test";
import assert from "node:assert/strict";
import { start } from "./serve.mjs";

async function page(server, query) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/desk.html?${query}`);
  assert.equal(res.status, 200);
  return res.text();
}

test("plain page is the committed Vite build with the query config and the version filled in", async () => {
  const server = await start(0);
  try {
    const html = await page(server, "store=static&snapshot=/snap/demo.json&workspace=W");
    assert.match(html, /<meta name="desk-src-hash" content="[0-9a-f]{64}">/);
    assert.match(html, /id="desk-config">\{"store":"static","snapshot":"\/snap\/demo.json","workspace":"W"\}<\/script>/);
    assert.ok(!html.includes("__ROUTINEOS_VERSION__"));
    assert.ok(!html.includes("(window.DESK_COMPONENTS = window.DESK_COMPONENTS"), "no component registered");
  } finally {
    server.close();
  }
});

test("bundle=desk and bundle=bad-components inject the fixture components before the app script", async () => {
  const server = await start(0);
  try {
    const desk = await page(server, "store=static&bundle=desk");
    const at = desk.indexOf('["salary-band"] = component_salary_band;');
    assert.ok(at > 0, "salary-band registered");
    assert.ok(at < desk.indexOf('<script type="module"'), "component before the app script");
    const bad = await page(server, "store=static&bundle=bad-components");
    assert.ok(bad.includes('["broken-one"]') && bad.includes('["shadow-el"]'));
  } finally {
    server.close();
  }
});

test("the split and mirror routes are gone", async () => {
  const server = await start(0);
  try {
    for (const path of ["/split/index.html", "/split-noprefetch/index.html", "/cdn-mirror/index.js"]) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
      assert.equal(res.status, 404, path);
    }
  } finally {
    server.close();
  }
});
