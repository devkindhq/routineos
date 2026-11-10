// app/pages/spec/states.js: the plain-text lines a spec page shows when a block has nothing to draw or the read stopped early.
export var EMPTY = "No data yet, the routine has not run";
export var LOADING = "Reading the data";
export var DRAW_FAILED = "This block could not be drawn";
export function skippedNote(n) {
  return n + (n === 1 ? " value" : " values") + " skipped, not a number";
}
export var PARTIAL = "Partial: the read stopped at its cap, so some data is missing";
