// app/zoomlock.js: stops pinch-to-zoom on touch screens, and gives it back when the viewer allows it. Text size is not
// touched: the browser or OS text-size setting still scales the root font size, and the rem sizing follows it.
// Two parts, both measured in Chromium (tests/visual/zoom.spec.mjs), standalone and in a cross-origin iframe:
//  - touch-action pan-x pan-y on the root: a two-finger pinch is not a gesture the page accepts; one-finger scroll stays.
//  - a touchmove with two or more touches, cancelled: the same result by script.
// And one part that is NOT measured here, because WebKit is not available to the tests:
//  - gesturestart and gesturechange, cancelled: WebKit-only events that iOS Safari uses to start a page zoom.
// A viewport meta with maximum-scale=1, user-scalable=no is not used: it had no effect on a pinch in Chromium, and iOS
// Safari ignores it.

var active = null;

function stop(e) { e.preventDefault(); }
function stopMulti(e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }

// lock true blocks pinch zoom, false gives it back. Safe to call again with the same value.
export function applyZoomLock(lock, doc) {
  doc = doc || document;
  lock = !!lock;
  if (lock === !!active) return;
  (lock ? doc : active).documentElement.style.touchAction = lock ? "pan-x pan-y" : "";
  if (lock) {
    doc.addEventListener("gesturestart", stop, { passive: false });
    doc.addEventListener("gesturechange", stop, { passive: false });
    doc.addEventListener("touchmove", stopMulti, { passive: false });
    active = doc;
  } else {
    active.removeEventListener("gesturestart", stop);
    active.removeEventListener("gesturechange", stop);
    active.removeEventListener("touchmove", stopMulti);
    active = null;
  }
}
