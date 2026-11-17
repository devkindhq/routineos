// window.DESK_LIB: the library registry namespaces (libraries.json, spec 16) handed to approved raw React pages.
// Pages register a thunk on window.DESK_PAGES that the host calls with DESK_LIB at mount (spec 5.3).
import LIBS from "virtual:desk-lib";

const lib = {};
for (const spec of Object.keys(LIBS)) lib[spec] = Object.freeze({ ...LIBS[spec] });

export const DESK_LIB = Object.freeze(lib);

window.DESK_LIB = DESK_LIB;
window.DESK_PAGES = window.DESK_PAGES || {};
