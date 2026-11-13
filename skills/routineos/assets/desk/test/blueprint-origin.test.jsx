import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, expect, test } from "vitest";
import Requirements from "../blueprint/Requirements.jsx";
import NodeDrawer from "../blueprint/NodeDrawer.jsx";

afterEach(cleanup);

var REQS = [
  { id: "fresh", text: "Pages are checked every morning", served_by: ["infra:w"], gap: false, origin: "pack" },
  { id: "mine", text: "I get a report", served_by: ["infra:w"], gap: false }];

function node(origin) {
  var n = { id: "infra:w", kind: "infra", label: "Worker", name: "w", state: "unverified", needs: null,
    source: { file: "routine.toml", key: "infra[0]" }, serves: [], detail: {} };
  if (origin) n.origin = origin;
  return n;
}

test("a requirement a pack supplied is marked unconfirmed, the person's own is not", () => {
  render(<MantineProvider><Requirements requirements={REQS} selected={null} highlighted={[]} onSelect={() => {}} onShowAll={() => {}} /></MantineProvider>);
  expect(screen.getByTestId("bp-pack-fresh").textContent).toBe("from a pack, unconfirmed");
  expect(screen.queryByTestId("bp-pack-mine")).toBeNull();
});

test("a part a pack supplied is marked unconfirmed in the drawer", () => {
  render(<MantineProvider><NodeDrawer node={node("pack")} requirements={REQS} onClose={() => {}} /></MantineProvider>);
  expect(screen.getByTestId("bp-drawer-pack").textContent).toBe("from a pack, unconfirmed");
});

test("a part with no origin has no pack mark", () => {
  render(<MantineProvider><NodeDrawer node={node(null)} requirements={REQS} onClose={() => {}} /></MantineProvider>);
  expect(screen.queryByTestId("bp-drawer-pack")).toBeNull();
});
