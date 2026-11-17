// T-M1: window.DESK_LIB holds exactly the library registry namespaces, frozen, on the Desk's own React.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { DESK_LIB } from "../app/deskLib.js";

const DESK = resolve(import.meta.dirname, "..");
const REGISTRY = JSON.parse(readFileSync(resolve(DESK, "libraries.json"), "utf8")).libraries;
const SPECIFIERS = REGISTRY.map((e) => e.specifier).sort();
const ICONS = "@tabler/icons-react";

describe("DESK_LIB", () => {
  it("has exactly the registry specifiers and is frozen", () => {
    expect(Object.keys(DESK_LIB).sort()).toEqual(SPECIFIERS);
    expect(Object.isFrozen(DESK_LIB)).toBe(true);
    for (const spec of SPECIFIERS) expect(Object.isFrozen(DESK_LIB[spec])).toBe(true);
  });

  it("exposes the Desk's own React", () => {
    expect(DESK_LIB.react.useState).toBe(React.useState);
    expect(DESK_LIB.react.createElement).toBe(React.createElement);
  });

  it("exposes Mantine dates and dayjs", () => {
    expect(["function", "object"]).toContain(typeof DESK_LIB["@mantine/dates"].DatePickerInput);
    expect(typeof DESK_LIB["@mantine/dates"].DatesProvider).toBe("function");
    expect(typeof DESK_LIB.dayjs.default).toBe("function");
  });

  it("exposes only the curated icon subset", () => {
    const subset = REGISTRY.find((e) => e.specifier === ICONS).exports;
    expect(DESK_LIB[ICONS].IconCheck).toBeDefined();
    expect(DESK_LIB[ICONS].IconZzzNotThere).toBeUndefined();
    expect(Object.keys(DESK_LIB[ICONS]).sort()).toEqual([...subset].sort());
  });

  it("is on window, with a DESK_PAGES object for raw pages", () => {
    expect(window.DESK_LIB).toBe(DESK_LIB);
    expect(typeof window.DESK_PAGES).toBe("object");
    expect(window.DESK_PAGES).not.toBeNull();
  });

  it("matches the generated export manifest", () => {
    const manifest = JSON.parse(readFileSync(resolve(DESK, "lib-exports.json"), "utf8"));
    expect(manifest.version).toBe(1);
    for (const spec of SPECIFIERS) {
      const names = Object.keys(DESK_LIB[spec]).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n)).sort();
      expect(manifest.exports[spec], spec).toEqual(names);
    }
  });
});
