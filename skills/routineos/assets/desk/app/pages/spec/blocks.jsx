// app/pages/spec/blocks.jsx: the four spec blocks by kind, shared by a spec page and by a code page's ui.block.
// SpecBlock draws one block from a spec and already-read records. The spec comes from a code page, so an unknown kind
// or a spec that makes a block throw draws nothing rather than taking the page down.
import { Component } from "react";
import { toRow } from "../../../core/pages/browse.js";
import { evalQuery } from "../../../core/pages/spec-query.js";
import ChartBlock from "./ChartBlock.jsx";
import DataTable from "./DataTable.jsx";
import TextBlock from "./TextBlock.jsx";
import Tile from "./Tile.jsx";

function Chart({ block, rows, ctx }) {
  var out = rows ? evalQuery(rows, block.query, ctx) : { points: [], skipped: 0 };
  return <ChartBlock spec={block} points={out.points} skipped={out.skipped} />;
}

export var BLOCKS = { tile: Tile, chart: Chart, table: DataTable, text: TextBlock };

class Quiet extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

export function SpecBlock({ spec, records }) {
  if (!spec || typeof spec !== "object" || !Object.prototype.hasOwnProperty.call(BLOCKS, spec.kind)) return null;
  return <Quiet><Inner spec={spec} records={records} /></Quiet>;
}

// The records come from a code page, so anything that is not an object is left out, and the mapping runs inside the boundary.
function Inner({ spec, records }) {
  var Block = BLOCKS[spec.kind];
  var rows = (Array.isArray(records) ? records : []).filter((d) => d && typeof d === "object")
    .map((d) => Object.assign(toRow(d, {}), { type: d.data && d.data.type }));
  var ctx = { now: Date.now(), range: null, filter: null };
  return <Block block={spec} rows={spec.query ? rows : null} ctx={ctx} />;
}
