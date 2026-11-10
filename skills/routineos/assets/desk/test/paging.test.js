import { expect, test } from "vitest";
import { FULL_READ_MAX, FULL_STEP, fullRead } from "../core/paging.js";

// A fake store holding `total` rows keyed k000001.. that honours the key > last, orderBy key, limit shape.
function fakeStore(total) {
  var keys = [];
  for (var i = 1; i <= total; i++) keys.push("k" + String(i).padStart(7, "0"));
  return {
    list: function (coll, q) {
      var gt = (q.where || []).filter(function (w) { return w[0] === "key" && w[1] === ">"; })[0];
      var rows = keys.filter(function (k) { return !gt || k > gt[2]; }).slice(0, q.limit);
      return Promise.resolve(rows.map(function (k) { return { id: k, data: { key: k } }; }));
    },
  };
}

test("a store holding exactly the read ceiling is read whole and not flagged capped", async () => {
  var out = await fullRead(fakeStore(FULL_STEP * FULL_READ_MAX), "entities", {});
  expect(out.length).toBe(FULL_STEP * FULL_READ_MAX);
  expect(out.capped).toBe(false);
});

test("a store holding one row more than the ceiling is flagged capped", async () => {
  var out = await fullRead(fakeStore(FULL_STEP * FULL_READ_MAX + 1), "entities", {});
  expect(out.length).toBe(FULL_STEP * FULL_READ_MAX);
  expect(out.capped).toBe(true);
});
