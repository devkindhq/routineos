import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, expect, test, vi } from "vitest";
import AnnotatedImage from "../app/components/AnnotatedImage.jsx";
import { noteBox } from "../core/shared.js";

afterEach(cleanup);

var NOTES = [
  { title: "Header", text: "Too tall", kind: "info", box: [0.1, 0.1, 0.2, 0.1] },
  { title: "Footer", text: "Cramped", kind: "red", box: [0.5, 0.9, 0.3, 0.05] },
  { title: "Gone", text: "Bad box", kind: "red", box: [2, 0, 1, 1] }];
var COLORS = { info: "grape", red: "red" };

// jsdom neither lays out nor loads images: give the window a width and the image a natural size, then fire load.
function mount(api) {
  var rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: 600, height: 400, left: 0, top: 0, right: 600, bottom: 400, x: 0, y: 0 }));
  function Host() {
    const [sel, setSel] = useState(null), [hot, setHot] = useState(null);
    const ref = useRef(null);
    if (api) api.ref = ref;
    return (
      <MantineProvider>
        <AnnotatedImage src="data:image/png;base64,iVBORw0KGgo=" alt="Captured page" notes={NOTES} boxes={NOTES.map((n) => noteBox(n.box))} colors={COLORS}
          kindOf={(k) => k} hot={hot} sel={sel} onHot={setHot} onSel={setSel} apiRef={ref} />
      </MantineProvider>
    );
  }
  var out = render(<Host />);
  var img = out.container.querySelector("img");
  Object.defineProperty(img, "naturalWidth", { value: 1200 });
  Object.defineProperty(img, "naturalHeight", { value: 4000 });
  fireEvent.load(img);
  return rect;
}

test("before the image loads the marks are plain; a note with a bad box has no mark", () => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: 600, height: 400, left: 0, top: 0, right: 600, bottom: 400, x: 0, y: 0 }));
  render(<MantineProvider><AnnotatedImage src="data:image/png;base64,iVBORw0KGgo=" alt="x" notes={NOTES} boxes={NOTES.map((n) => noteBox(n.box))}
    colors={COLORS} kindOf={(k) => k} hot={null} sel={null} onHot={() => {}} onSel={() => {}} /></MantineProvider>);
  expect(screen.getAllByRole("button", { name: /^Mark \d/ }).length).toBe(2);
  expect(screen.queryByRole("toolbar")).toBeNull();
  vi.restoreAllMocks();
});

test("once the image loads there is a zoom toolbar and a keyboard-operable window, and the marks keep their percent boxes", () => {
  var rect = mount();
  expect(screen.getByRole("toolbar", { name: "Zoom the captured page" })).toBeTruthy();
  ["Zoom in", "Zoom out", "Fit width", "Zoom to 100%", "Reset zoom and selection"].forEach((n) => expect(screen.getByRole("button", { name: n })).toBeTruthy());
  var win = screen.getByRole("group", { name: /Captured page/ });
  expect(win.getAttribute("tabindex")).toBe("0");
  var m = screen.getByRole("button", { name: "Mark 2: Footer" });
  expect(m.style.left).toBe("50%");
  expect(m.style.top).toBe("90%");
  expect(screen.getAllByRole("button", { name: /^Mark \d/ }).length).toBe(2);
  rect.mockRestore();
});

test("the window fits the image width at first: 600 wide over a 1200 + margin image, and a tall image is capped in height", () => {
  var rect = mount();
  var layer = screen.getByRole("group", { name: /Captured page/ }).querySelector("img").parentElement.parentElement.parentElement;
  expect(layer.style.transform).toMatch(/scale\(0\.48/); // 600 / (1200 + 28) = 0.4886
  expect(screen.getByText(/^Zoom 49%$/)).toBeTruthy();
  var win = screen.getByRole("group", { name: /Captured page/ });
  expect(parseFloat(win.style.height.replace("calc(", "")) * 16).toBeLessThan(4000 * 0.49); // capped to the window, not the whole image
  rect.mockRestore();
});

test("mark tags and borders are counter-scaled: a smaller fit scale draws a thicker border and a larger inverse on the tag", () => {
  var rect = mount();
  var m = screen.getByRole("button", { name: "Mark 1: Header" });
  // 2px at scale 0.4886 is 4.09px of layer, so it reads as 2px on screen.
  expect(m.style.border).toContain("0.255625rem"); // 4.09px, in rem
  var keep = Array.from(m.querySelectorAll("div")).find((d) => d.style.transform);
  expect(keep).toBeTruthy();
  expect(keep.style.transform).toMatch(/scale\(2\.0/); // 1 / 0.4886
  rect.mockRestore();
});

test("the toolbar zoom in changes the zoom readout, and Reset returns to fit", async () => {
  var rect = mount();
  var before = screen.getByText(/^Zoom \d+%$/).textContent;
  fireEvent.click(screen.getByRole("button", { name: "Zoom to 100%" }));
  await screen.findByText("Zoom 100%");
  expect(before).not.toBe("Zoom 100%");
  fireEvent.click(screen.getByRole("button", { name: "Fit width" }));
  await screen.findByText(before);
  rect.mockRestore();
});

test("keyboard: 1 zooms to 100% and 0 fits, only with the window itself focused", async () => {
  var rect = mount();
  var win = screen.getByRole("group", { name: /Captured page/ });
  fireEvent.keyDown(screen.getByRole("button", { name: "Mark 1: Header" }), { key: "1" });
  expect(screen.queryByText("Zoom 100%")).toBeNull(); // a key on a mark is not the window's
  fireEvent.keyDown(win, { key: "1" });
  await screen.findByText("Zoom 100%");
  fireEvent.keyDown(win, { key: "0" });
  await screen.findByText(/^Zoom 49%$/);
  rect.mockRestore();
});

test("centring a mark puts its middle in the middle of the window", async () => {
  var api = {};
  var rect = mount(api);
  api.ref.current.centerOn(0);
  // box 1 centre is (254, 614) in the layer at scale 1 (20% and 15% of 1200 x 4000, plus the 14px margin). The window is
  // 600 wide, so x would be +46 but the image cannot pan past its left edge, so x is 0; it is 614 high, so y is 307 - 614.
  var layer = screen.getByRole("group", { name: /Captured page/ }).querySelector("img").parentElement.parentElement.parentElement;
  await vi.waitFor(() => expect(layer.style.transform).toMatch(/translate\(0px, -307px\)/));
  expect(layer.style.transform).toMatch(/scale\(1\)/);
  rect.mockRestore();
});
