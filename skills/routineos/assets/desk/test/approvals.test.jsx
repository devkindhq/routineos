import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { notifications } from "@mantine/notifications";
import App from "../app/App.jsx";
import { REPORT_ONLY_NOTE } from "../core/pages/approvals.js";
import { ReadOnlyError, createStore } from "../core/store.js";

var DEFINITION = {
  types: { roles: { plural: "Roles", fields: { title: { label: "Title", type: "text" } } } },
  producers: [{ id: "scout", label: "Scout", types: ["roles"] }],
};

var VIEW = { madeBy: "agent", producer: "scout", state: "proposed", name: "Senior roles", type: "roles", createdAt: "2026-11-05T00:00:00Z" };

function docs(extra) {
  return Object.assign({
    "meta/definition": { data: DEFINITION },
    "meta/workspace": { data: { name: "Test workspace" } },
    "views/senior": { data: VIEW },
    "pending/g1": { data: { producer: "scout", title: "Send the weekly note", createdAt: "2026-11-05T00:00:00Z", status: "pending" } },
    "decisions/g0": { data: { decision: "approve", by: "u1", at: "2026-11-04T00:00:00Z" } },
    "pending/g0": { data: { producer: "scout", title: "Old gate", createdAt: "2026-11-03T00:00:00Z", status: "pending" } },
    "runs/scout-20261104": { data: { producer: "scout", startedAt: "2026-11-04T06:00:00Z", status: "ok", processed: [{ request: "g0", outcome: "applied" }] } },
  }, extra || {});
}

function staticStore(extra) {
  return createStore("static", { docs: docs(extra) });
}

function writable(store, viewer) {
  store.readOnly = false;
  store.viewer = () => Promise.resolve(viewer || "u1");
  store.set = vi.fn(() => Promise.resolve());
  store.del = vi.fn(() => Promise.resolve());
  return store;
}

async function mount(hash, store) {
  window.history.replaceState(null, "", hash);
  render(<App store={store || staticStore()} config={{ store: "static", workspace: "Test workspace" }} />);
  return screen.findByRole("heading", { level: 1, name: "Approvals" });
}

function card(title) {
  return screen.getByText(title).closest("[data-id]");
}

beforeEach(() => {
  try { localStorage.clear(); } catch (e) { /* storage blocked */ }
  notifications.clean();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#/today");
});

test("Waiting lists the gate and the proposed view", async () => {
  await mount("#/approvals");
  expect(await screen.findByText("Send the weekly note")).toBeTruthy();
  expect(screen.getByText("Proposed view: Senior roles")).toBeTruthy();
  expect(screen.getByRole("tab", { name: /Waiting/ }).getAttribute("aria-selected")).toBe("true");
});

test("approving a view shows a notification with Undo, and Undo restores the prior doc", async () => {
  var store = writable(staticStore());
  await mount("#/approvals", store);
  await screen.findByText("Proposed view: Senior roles");
  fireEvent.click(within(card("Proposed view: Senior roles")).getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("views/senior", expect.objectContaining({ state: "kept", updatedBy: "u1" })));
  expect(await screen.findByText("Approved: Proposed view: Senior roles")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(store.set).toHaveBeenLastCalledWith("views/senior", VIEW));
  expect(await screen.findByText("Back to Waiting. Nothing was sent to the routine.")).toBeTruthy();
});

test("approving a gate writes decisions/<id>, and Undo removes it", async () => {
  var store = writable(staticStore());
  await mount("#/approvals", store);
  await screen.findByText("Send the weekly note");
  fireEvent.click(within(card("Send the weekly note")).getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("decisions/g1", expect.objectContaining({ decision: "approve", by: "u1" })));
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(store.del).toHaveBeenCalledWith("decisions/g1"));
});

test("Decline with a note writes a reject with the note", async () => {
  var store = writable(staticStore());
  await mount("#/approvals", store);
  await screen.findByText("Send the weekly note");
  var c = card("Send the weekly note");
  fireEvent.click(within(c).getByRole("button", { name: "Add note" }));
  fireEvent.change(within(c).getByRole("textbox", { name: "Note for the routine" }), { target: { value: "Not a fit" } });
  expect(within(c).getByRole("button", { name: "Approve with instructions" })).toBeTruthy();
  fireEvent.click(within(c).getByRole("button", { name: "Decline" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("decisions/g1", expect.objectContaining({ decision: "reject", reason: "Not a fit" })));
});

test("a refused decision write says why", async () => {
  var store = writable(staticStore());
  store.set = vi.fn(() => Promise.reject(new ReadOnlyError()));
  await mount("#/approvals", store);
  await screen.findByText("Send the weekly note");
  fireEvent.click(within(card("Send the weekly note")).getByRole("button", { name: "Approve" }));
  expect(await screen.findByText("Demo data, read only")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

test("a joined member who is not the owner sees no decision controls", async () => {
  var store = writable(staticStore({ "meta/join": { data: { open: true } }, "meta/owner": { data: { by: "u1", at: "2026-11-01T00:00:00Z" } } }), "u2");
  await mount("#/approvals", store);
  await screen.findByText("Send the weekly note");
  expect(screen.getByText(REPORT_ONLY_NOTE)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
});

test("a read-only visit sees no decision controls", async () => {
  await mount("#/approvals");
  await screen.findByText("Send the weekly note");
  expect(screen.getByText(REPORT_ONLY_NOTE)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
});

test("#/approvals?t=done behaves as ?tab=done", async () => {
  await mount("#/approvals?t=done");
  await waitFor(() => expect(screen.getByRole("tab", { name: /Done/ }).getAttribute("aria-selected")).toBe("true"));
  expect(await screen.findByText("Old gate")).toBeTruthy();
  expect(screen.queryByText("Send the weekly note")).toBeNull();
});

test("Approvals shows a queued banner for pending requests, not for handled ones", async () => {
  var req = (status) => ({ data: { kind: "run-now", routine: "scout", status: status, createdAt: "2026-11-05T00:00:00Z" } });
  var defn = Object.assign({}, DEFINITION, { producers: [{ id: "scout", label: "Scout", types: ["roles"], schedule: "0 6 * * *" }] });
  var store = staticStore({ "meta/definition": { data: defn }, "requests/req~a": req("pending"), "requests/req~b": req("pending"),
    "runs/scout-20261105": { data: { producer: "scout", startedAt: "2026-11-05T06:00:00Z", status: "ok", processed: [{ request: "req~b", outcome: "applied" }] } } });
  await mount("#/approvals", store);
  expect(await screen.findByText(/^1 queued for next run/)).toBeTruthy();
});

test("Approvals has no queued banner when nothing is queued", async () => {
  await mount("#/approvals", staticStore());
  await screen.findByText("Send the weekly note");
  expect(screen.queryByText(/queued for next run/)).toBeNull();
});

test("the note toggle reads Add note then Remove note, and Esc closes only an empty box", async () => {
  await mount("#/approvals", writable(staticStore()));
  await screen.findByText("Send the weekly note");
  var c = card("Send the weekly note");
  fireEvent.click(within(c).getByRole("button", { name: "Add note" }));
  var box = within(c).getByLabelText("Note for the routine");
  fireEvent.keyDown(box, { key: "Escape" });
  expect(within(c).queryByLabelText("Note for the routine")).toBeNull();
  fireEvent.click(within(c).getByRole("button", { name: "Add note" }));
  box = within(c).getByLabelText("Note for the routine");
  fireEvent.change(box, { target: { value: "hello" } });
  fireEvent.keyDown(box, { key: "Escape" });
  expect(within(c).getByLabelText("Note for the routine")).toBeTruthy();
  fireEvent.click(within(c).getByRole("button", { name: "Remove note" }));
  expect(within(c).queryByLabelText("Note for the routine")).toBeNull();
  expect(within(c).getByRole("button", { name: "Approve" })).toBeTruthy();
});
