import { expect, test } from "vitest";
import { readSpecRows } from "../core/pages/spec-read.js";
import { FULL_READ_MAX, FULL_STEP } from "../core/paging.js";

// A fake store honouring where (== and key >), orderBy key asc and limit.
function fakeStore(docs) {
  return {
    list: function (coll, q) {
      var rows = docs.filter(function (d) {
        return (q.where || []).every(function (w) {
          var v = d.data[w[0]];
          return w[1] === "==" ? v === w[2] : v > w[2];
        });
      });
      rows.sort(function (a, b) { return a.data.key < b.data.key ? -1 : 1; });
      return Promise.resolve(rows.slice(0, q.limit));
    },
  };
}

function metric(i, extra) {
  var key = "k" + String(i).padStart(7, "0");
  return { id: key, data: Object.assign({ type: "metric", key: key, lastSeen: "2026-11-01", display: { value: i } }, extra || {}) };
}

test("a weekly 12 x 3 x 5 history is read whole and not capped", async () => {
  var docs = [];
  for (var i = 1; i <= 180; i++) docs.push(metric(i));
  docs.push({ id: "other", data: { type: "audit", key: "zz", display: {} } });
  var out = await readSpecRows(fakeStore(docs), { type: "metric" });
  expect(out.rows.length).toBe(180);
  expect(out.capped).toBe(false);
  expect(out.rows.every(function (r) { return r.type === "metric"; })).toBe(true);
  expect(out.rows[0].f.value).toBe(1);
  expect(typeof out.readAt).toBe("number");
});

test("a history past the read ceiling is flagged capped", async () => {
  var docs = [];
  for (var i = 1; i <= FULL_STEP * FULL_READ_MAX + 1; i++) docs.push(metric(i));
  var out = await readSpecRows(fakeStore(docs), { type: "metric" });
  expect(out.rows.length).toBe(FULL_STEP * FULL_READ_MAX);
  expect(out.capped).toBe(true);
});
