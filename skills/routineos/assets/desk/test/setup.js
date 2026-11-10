// jsdom lacks matchMedia and ResizeObserver, which Mantine uses. Like a browser, an empty query matches; every
// other query does not, so a column shown only on wide screens stays hidden here.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: String(query).trim() === "",
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
// jsdom has no FontFaceSet; Mantine's autosize Textarea listens on document.fonts.
if (!document.fonts) {
  Object.defineProperty(document, "fonts", { configurable: true, value: { addEventListener() {}, removeEventListener() {}, ready: Promise.resolve() } });
}
