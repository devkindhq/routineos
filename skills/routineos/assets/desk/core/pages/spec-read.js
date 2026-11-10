// core/pages/spec-read.js: read the entity rows a spec page query needs.
// Spike conclusion: windowing is client side. The store `where` cannot reach nested `display` fields, so this
// reads every entity of the query's type (fullRead, key order) and the evaluator (spec-query.js) windows and
// filters. The weekly 12 weeks x 3 sources data is far below the 30,000 row cap. A very long history hits the
// cap and the page shows the partial notice. Precomputed series docs remain an option if real histories exceed it.
import { fullRead } from "../paging.js";
import { toRow } from "./browse.js";

// Resolves {rows, capped, readAt}. A row is toRow(doc) plus `type`.
export function readSpecRows(store, query) {
  return fullRead(store, "entities", { where: [["type", "==", query.type]] }).then(function (docs) {
    var rows = docs.map(function (d) {
      var row = toRow(d, {});
      row.type = d.data && d.data.type;
      return row;
    });
    return { rows: rows, capped: docs.capped === true, readAt: Date.now() };
  });
}
