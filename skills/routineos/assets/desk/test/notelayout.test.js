import { expect, test } from "vitest";
import { noteBox } from "../core/shared.js";
import { CARD_GAP, LIFT, cardTops, centerTransform, clampAxis, counterScale, fitScale, focusExcerpt, gutterWidth, leaderPath, placedOrder, offScreen, rescaleAtCenter, viewerHeight } from "../app/components/noteLayout.js";

test("noteBox turns a fractional box into percents and refuses anything outside the image", () => {
  expect(noteBox([0.1, 0.25, 0.5, 0.05])).toEqual({ left: "10%", top: "25%", width: "50%", height: "5%" });
  expect(noteBox([0, 0, 1, 1])).toEqual({ left: "0%", top: "0%", width: "100%", height: "100%" });
  [[0.9, 0, 0.2, 0.1], [-0.1, 0, 0.2, 0.1], [0, 0, 0, 0.1], [0, 0, 0.1, NaN], [0, 0, 0.1], null, "x"].forEach((b) => expect(noteBox(b)).toBeNull());
});

test("gutterWidth is about a fifth of the pane, held between 200 and 240px, so the image gets the rest", () => {
  expect(gutterWidth(1000)).toBe(220);
  expect(gutterWidth(1400)).toBe(240);
  expect(gutterWidth(700)).toBe(200);
});

test("placedOrder sorts the placed notes by box top then left, keeps data order on a tie and skips unplaced notes", () => {
  var boxes = [noteBox([0.5, 0.5, 0.1, 0.1]), null, noteBox([0.1, 0.2, 0.1, 0.1]), noteBox([0.05, 0.5, 0.1, 0.1]), noteBox([0.05, 0.5, 0.2, 0.1])];
  expect(placedOrder(boxes)).toEqual([2, 3, 4, 0]);
});

test("cardTops starts each card LIFT above its mark, keeps the gap between cards and pulls the last one inside the image", () => {
  var r = cardTops([{ y: 100, h: 40 }, { y: 110, h: 40 }, { y: 600, h: 50 }], 640);
  expect(r.tops[0]).toBe(100 - LIFT);
  expect(r.tops[1]).toBe(r.tops[0] + 40 + CARD_GAP); // pushed down off the card above
  expect(r.tops[2]).toBe(582); // 600 - 18, ending at 632, inside 640
  expect(r.fits).toBe(true);
  var low = cardTops([{ y: 630, h: 50 }], 640);
  expect(low.tops[0]).toBe(590); // pulled up so it ends at 640
  expect(cardTops([{ y: 5, h: 40 }], 640).tops[0]).toBe(0); // never above the image
});

test("cardTops reports that the cards do not fit when they cannot all end inside the image", () => {
  var items = Array.from({ length: 6 }, (_, k) => ({ y: k * 10, h: 60 }));
  var r = cardTops(items, 300);
  expect(r.fits).toBe(false);
  for (var k = 1; k < r.tops.length; k++) expect(r.tops[k]).toBeGreaterThanOrEqual(r.tops[k - 1] + 60 + CARD_GAP);
});

test("leaderPath runs from the box edge past the image to just before the card", () => {
  var p = leaderPath({ right: 300, midY: 120 }, { left: 700, top: 100, h: 80 }, 640);
  expect(p.d).toBe("M300 120 L650 120 L692 115 L700 115");
  expect(p.dot).toEqual({ x: 300, y: 120 });
  expect(leaderPath({ right: 639, midY: 10 }, { left: 700, top: 0, h: 20 }, 640).d).toContain("L650 10"); // bend at least 10px past the image
  expect(leaderPath({ right: 700, midY: 10 }, { left: 800, top: 0, h: 20 }, 640).d).toContain("L706 10"); // or 6px past the box
});

test("offScreen is true unless the rectangle sits wholly inside the viewport", () => {
  expect(offScreen({ top: 10, bottom: 60 }, 800)).toBe(false);
  expect(offScreen({ top: -1, bottom: 60 }, 800)).toBe(true);
  expect(offScreen({ top: 780, bottom: 830 }, 800)).toBe(true);
  expect(offScreen({ top: 900, bottom: 950 }, 800)).toBe(true);
});

test("fitScale is the viewer width over the natural width, and 1 when either is unknown", () => {
  expect(fitScale(1080, 720)).toBeCloseTo(1.5, 5);
  expect(fitScale(360, 720)).toBeCloseTo(0.5, 5);
  expect(fitScale(0, 720)).toBe(1);
  expect(fitScale(800, 0)).toBe(1);
});

test("viewerHeight shows a short image whole and gives a tall one a window of about 80% of the screen", () => {
  expect(viewerHeight(600, 900)).toBe(600); // 720px image at fit 1080 wide is 8k tall, a short page is under the window
  expect(viewerHeight(7866, 900)).toBe(720);
  expect(viewerHeight(7866, 300)).toBe(320);
});

test("counterScale undoes the zoom so a badge keeps its size", () => {
  expect(counterScale(2)).toBe(0.5);
  expect(counterScale(0.25)).toBe(4);
  expect(counterScale(0)).toBe(1);
  expect(2 * counterScale(2)).toBe(1);
});

test("clampAxis centres content smaller than the view and keeps larger content covering it", () => {
  expect(clampAxis(-50, 800, 400)).toBe(200);
  expect(clampAxis(50, 400, 800)).toBe(0);
  expect(clampAxis(-1000, 400, 800)).toBe(-400);
  expect(clampAxis(-120, 400, 800)).toBe(-120);
});

test("centerTransform puts a mark in the middle of the view, clamped to the image", () => {
  var nat = { w: 720, h: 5244 }, view = { w: 1080, h: 700 }, s = 1.5;
  // a mark at the middle of the page, 4% tall: its centre is 0.5 * 5244 * 1.5 = 3933 down
  var t = centerTransform({ left: "10%", top: "49%", width: "20%", height: "2%" }, nat, s, view);
  expect(t.scale).toBe(1.5);
  expect(t.x).toBe(0); // the image fills the view's width at fit
  expect(t.y).toBeCloseTo(350 - 0.5 * 5244 * 1.5, 3);
  // near the top the pan stops at 0, near the bottom at the last screen
  expect(centerTransform({ left: "0%", top: "0%", width: "1%", height: "1%" }, nat, s, view).y).toBe(0);
  expect(centerTransform({ left: "0%", top: "99%", width: "1%", height: "1%" }, nat, s, view).y).toBe(700 - 5244 * 1.5);
  // zoomed in past the view, a mark at the right edge pans to the right edge
  var z = centerTransform({ left: "95%", top: "10%", width: "4%", height: "1%" }, nat, 3, view);
  expect(z.x).toBe(1080 - 720 * 3);
});

test("focusExcerpt keeps the flagged phrase in view and drops a leading heading mark", () => {
  var long = "Opening words that carry on for a good while before anything happens, with many more of them to pad it out so that the flagged phrase sits far from the start. Then **ISO 9001** is named here and the sentence goes on for a long way after it too, to fill the space beyond the limit";
  var out = focusExcerpt(long, 120);
  expect(out).toContain("**ISO 9001**");
  expect(out.length).toBeLessThan(150);
  expect(out.startsWith("... ")).toBe(true);
  expect(out.endsWith(" ...")).toBe(true);
  expect(focusExcerpt("## Short **bold** text", 120)).toBe("Short **bold** text");
  expect(focusExcerpt("x ".repeat(200), 50)).toBe("x ".repeat(200));
});

test("centerTransform allows for the margin around the image", () => {
  var t = centerTransform({ left: "50%", top: "50%", width: "0%", height: "0%" }, { w: 100, h: 1000 }, 2, { w: 300, h: 400 }, 10);
  expect(t.y).toBe(200 - (10 + 500) * 2); // middle of the image, plus the margin, at 2x
  expect(t.x).toBe((300 - 120 * 2) / 2 + 0); // 120 * 2 = 240 is narrower than the view, so it is centred
});

test("rescaleAtCenter keeps the spot in the middle of the view when the scale changes", () => {
  var at = { x: -300, y: -1000, scale: 2 }; // view 600 x 400: centre spot is content (300, 600)
  var t = rescaleAtCenter(at, 1, { w: 800, h: 5000 }, { w: 600, h: 400 });
  expect(t.x).toBe(0 > 300 - 300 ? 0 : 300 - 300); // content (300, 600) at 1x is 300, 600 from the corner
  expect(t.y).toBe(200 - 600);
  expect(t.scale).toBe(1);
});
