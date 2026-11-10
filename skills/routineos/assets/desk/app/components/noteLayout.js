// app/components/noteLayout.js: the geometry of image notes, pure so it tests without a browser. Order of the cards,
// the gutter width, where each card sits beside the image and the path of the leader from a card to its mark.
export var WIDE_MIN = 700; // pane width from which the cards sit in a gutter beside the image
export var CARD_GAP = 8;
export var LIFT = 18; // a card starts this far above its mark

// The card strip beside the image: 200 to 240px, about a fifth of the pane, so the image gets the rest.
export function gutterWidth(paneW) {
  return Math.round(Math.max(200, Math.min(240, paneW * 0.22)));
}

// The scale at which the image is exactly as wide as the viewer (fit width). 1 when either width is unknown.
export function fitScale(viewW, naturalW) {
  return viewW > 0 && naturalW > 0 ? viewW / naturalW : 1;
}

// Viewer height in px: the whole image at fit width when that is shorter than most of the screen, otherwise about
// four fifths of the screen (never under 320), so a tall capture pans inside a window and the card strip beside it is
// no taller than the window.
export function viewerHeight(imageH, screenH) {
  return Math.round(Math.min(imageH, Math.max(320, screenH * 0.8)));
}

// The factor that keeps a badge the same size on screen at a zoom scale.
export function counterScale(scale) {
  return scale > 0 ? 1 / scale : 1;
}

// One axis of a pan position kept inside its bounds: content smaller than the view sits centred, larger fills the view.
export function clampAxis(pos, view, content) {
  if (content <= view) return (view - content) / 2;
  return Math.max(view - content, Math.min(0, pos));
}

// The pan that puts the middle of a mark in the middle of the view at a scale. box: a noteBox result (percent strings),
// nat: {w, h} natural image size, view: {w, h} viewer size. Returns the position for setTransform, clamped to the image.
// pad: the margin around the image inside the zoomed layer, in natural px (default 0).
export function centerTransform(box, nat, scale, view, pad) {
  var p = pad || 0;
  var cx = (p + (parseFloat(box.left) + parseFloat(box.width) / 2) / 100 * nat.w) * scale;
  var cy = (p + (parseFloat(box.top) + parseFloat(box.height) / 2) / 100 * nat.h) * scale;
  return { x: clampAxis(view.w / 2 - cx, view.w, (nat.w + 2 * p) * scale), y: clampAxis(view.h / 2 - cy, view.h, (nat.h + 2 * p) * scale), scale: scale };
}

// The pan for a new scale that keeps the middle of the view on the same spot of the content. at: {x, y, scale} now,
// content: {w, h} natural size of the zoomed layer, view: {w, h}.
export function rescaleAtCenter(at, scale, content, view) {
  var cx = (view.w / 2 - at.x) / at.scale, cy = (view.h / 2 - at.y) / at.scale;
  return { x: clampAxis(view.w / 2 - cx * scale, view.w, content.w * scale), y: clampAxis(view.h / 2 - cy * scale, view.h, content.h * scale), scale: scale };
}

// A note's text cut to about max characters around its first **flagged** phrase, so a clamped card still shows what was
// flagged. A leading heading mark is dropped. Text with no phrase, or already short, is returned whole (heading mark
// dropped); a cut shows an ellipsis on the cut side.
export function focusExcerpt(text, max) {
  var t = String(text || "").replace(/^\s*#{1,6}\s+/, "");
  if (t.length <= max) return t;
  var m = /\*\*[^*]+\*\*/.exec(t);
  if (!m) return t;
  var mid = m.index + m[0].length / 2, start = Math.max(0, Math.round(mid - max / 2)), end = Math.min(t.length, start + max);
  start = Math.max(0, end - max);
  if (start > m.index) start = m.index;
  if (end < m.index + m[0].length) end = m.index + m[0].length;
  var sp = start > 0 ? t.indexOf(" ", start) : -1;
  if (sp !== -1 && sp < m.index) start = sp + 1;
  var sp2 = end < t.length ? t.lastIndexOf(" ", end) : -1;
  if (sp2 > m.index + m[0].length) end = sp2;
  return (start > 0 ? "... " : "") + t.slice(start, end) + (end < t.length ? " ..." : "");
}

// Indexes of the notes that have a box (noteBox output), ordered by box top then box left, then data order.
export function placedOrder(boxes) {
  var out = [];
  boxes.forEach((b, i) => { if (b) out.push(i); });
  return out.sort((a, b) => {
    var A = boxes[a], B = boxes[b];
    return (parseFloat(A.top) - parseFloat(B.top)) || (parseFloat(A.left) - parseFloat(B.left)) || (a - b);
  });
}

// Card tops beside an image imageH tall. items: [{y, h}] in card order, y the top of the mark and h the card height, both
// in px from the top of the image. Each card starts LIFT above its mark, clears the card before it by CARD_GAP, and is
// pulled up so it ends inside the image; a forward pass then restores the gap. fits is false when the cards cannot all
// end inside the image, and the caller lists them from the top instead of beside their marks.
export function cardTops(items, imageH) {
  var tops = items.map((it) => Math.max(0, Math.min(it.y - LIFT, imageH - it.h)));
  var bottom = -CARD_GAP;
  tops = tops.map((t, k) => {
    var top = Math.max(t, bottom + CARD_GAP);
    bottom = top + items[k].h;
    return top;
  });
  return { tops, fits: bottom <= imageH + 0.5 };
}

// The leader from a card to its mark, all in px in one frame. mark: {right, midY}, card: {left, top, h}, imageRight the
// right edge of the image. Out from the box's right edge to a bend past the image, across to just before the card.
export function leaderPath(mark, card, imageRight) {
  var kx = Math.max(mark.right + 6, imageRight + 10);
  var ly = card.top + Math.min(15, card.h / 2);
  var f = (n) => Math.round(n * 10) / 10;
  return {
    d: "M" + f(mark.right) + " " + f(mark.midY) + " L" + f(kx) + " " + f(mark.midY) + " L" + f(card.left - 8) + " " + f(ly) + " L" + f(card.left) + " " + f(ly),
    dot: { x: f(mark.right), y: f(mark.midY) },
  };
}

// True when a rectangle (viewport px) is not wholly inside a viewport vh tall.
export function offScreen(rect, vh) {
  return rect.top < 0 || rect.bottom > vh;
}
