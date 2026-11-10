// Every golden in tests/visual/golden has a provenance entry in golden/PROVENANCE.md: where it was captured, its last
// change, and what reads it now. The record lives beside the goldens, never inside store-calls.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "golden");
const DOC = join(DIR, "PROVENANCE.md");

test("each golden has a provenance section naming its capture, last change and reader", () => {
  assert.ok(existsSync(DOC), "golden/PROVENANCE.md is missing");
  const doc = readFileSync(DOC, "utf8");
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".json"))) {
    const at = doc.indexOf("## " + f + "\n");
    assert.notEqual(at, -1, `no section for ${f}`);
    const next = doc.indexOf("\n## ", at + 1);
    const body = doc.slice(at, next === -1 ? undefined : next);
    for (const key of ["Captured:", "Last changed:", "Read by:"]) assert.match(body, new RegExp("^- " + key + " \\S", "m"), `${f}: ${key}`);
  }
});
