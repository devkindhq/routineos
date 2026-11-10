// app/components/AnnotatedImage.jsx: a captured page with one outlined, numbered mark per placed note, in a zoom and pan
// window. Marks are percent boxes inside the zoomed layer, so they sit right at any scale; their number tag and border
// are counter-scaled so they stay the same size on screen. Each mark is a focusable button named "Mark N: title". Its
// note text shows on hover, focus and tap; a click selects it (pinned), a second click or Esc releases it. The window
// starts at fit-width; the toolbar, the keyboard (+ - 0 1 and arrows), Ctrl or Cmd with the wheel, and a two finger pinch
// zoom it; a plain wheel pans until an edge and then lets the page scroll. Until the image has loaded (its natural size
// is the zoom layer's size) the image and marks draw as plain, so marks and cards never wait on the zoom.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Badge, Box, Button, Group, Image, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { KeepScale, TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { centerTransform, clampAxis, counterScale, fitScale, rescaleAtCenter, viewerHeight } from "./noteLayout.js";

var PAD = 14; // margin around the image in the zoomed layer, so a tag hanging off a corner never clips
var STEP = 1.25;
var FOCUS_SCALE = 1; // a mark picked from a card or by keyboard is centred at least this zoomed (natural size)

// One mark. scale 0 means not zoomable yet (plain pre-load drawing); otherwise the border width and tag are counter-scaled.
function Mark({ n, i, b, color, hot, sel, scale, onHot, onSel, onFocusMark }) {
  var on = hot === i || sel === i;
  var px = (sel === i ? 5 : on ? 3 : 2) * (scale ? counterScale(scale) : 1);
  var tag = (
    <Badge aria-hidden="true" color={color} radius="xl" px={6} miw="22px" w="max-content" pos="absolute" left={-10} top={-10} size={sel === i ? "xl" : "md"}>{String(i + 1)}</Badge>
  );
  return (
    <Tooltip opened={on} multiline maw={280} withArrow label={(n.title ? n.title + ": " : "") + String(n.text || "").replace(/^\s*#{1,6}\s+/, "").replace(/\*\*|__/g, "")}>
      <UnstyledButton
        aria-label={"Mark " + (i + 1) + (n.title ? ": " + n.title : "")} aria-pressed={sel === i} data-mark={i}
        pos="absolute" left={b.left} top={b.top} w={b.width} h={b.height}
        bd={px.toFixed(2) + "px solid var(--mantine-color-" + color + "-filled)"}
        bg={on ? "color-mix(in srgb, var(--mantine-color-" + color + "-filled) 12%, transparent)" : undefined}
        onMouseEnter={() => onHot(i)} onMouseLeave={() => onHot(null)}
        onFocus={(e) => { onHot(i); onFocusMark(i, e.currentTarget); }} onBlur={() => onHot(null)}
        onClick={() => onSel(sel === i ? null : i)}>
        {scale ? (
          <Box pos="absolute" left={0} top={0} w={0} h={0}><KeepScale>{tag}</KeepScale></Box>
        ) : tag}
      </UnstyledButton>
    </Tooltip>
  );
}

// notes: [{n, title, text, kind}] in data order, boxes: parallel percent boxes (null when not placed), colors: kind to
// Mantine color, hot/sel: the hovered or focused and the pinned note index (or null), onHot(i|null), onSel(i|null).
// apiRef.current is set to {centerOn(i), fit()} once zoomable. onView({h, atFit, zoomable}) reports the window height and
// whether it sits at its fit-width start, for the caller's card strip and leader lines.
export default function AnnotatedImage({ src, alt, notes, boxes, colors, hot, sel, onHot, onSel, kindOf, onLoad, apiRef, onView }) {
  const [nat, setNat] = useState(null);
  const [viewW, setViewW] = useState(0);
  const [tf, setTf] = useState({ scale: 0, x: 0, y: 0 });
  const winRef = useRef(null), zref = useRef(null), live = useRef(null);
  var content = nat ? { w: nat.w + 2 * PAD, h: nat.h + 2 * PAD } : null;
  var fit = content && viewW ? fitScale(viewW, content.w) : 0;
  var viewH = fit ? viewerHeight(content.h * fit, typeof window === "undefined" ? 900 : window.innerHeight) : 0;
  var minScale = fit * 0.25, maxScale = Math.max(fit * 6, 3);
  live.current = { nat, content, fit, viewW, viewH, minScale, maxScale };

  useEffect(() => {
    if (sel === null) return undefined;
    function esc(e) { if (e.key === "Escape") onSel(null); }
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [sel, onSel]);

  useLayoutEffect(() => {
    var el = winRef.current;
    if (!el) return undefined;
    function read() { setViewW(Math.round(el.getBoundingClientRect().width)); }
    read();
    if (typeof ResizeObserver !== "function") return undefined;
    var ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!nat]);

  var cur = tf.scale || fit; // the library reports a transform only when it changes, so until then it is at its start
  var atFit = !!fit && Math.abs(cur - fit) < 0.005 && Math.abs(tf.x) < 1.5 && Math.abs(tf.y) < 1.5;
  useEffect(() => { if (onView) onView({ h: viewH, atFit: atFit, zoomable: !!fit }); }, [viewH, atFit, !!fit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setTf({ scale: 0, x: 0, y: 0 }); }, [fit.toFixed(2)]); // a new fit remounts the window at its start
  var state = useCallback(() => {
    var z = zref.current;
    return z && z.instance ? z.instance.state : null;
  }, []);
  var go = useCallback((t, ms) => {
    var z = zref.current;
    if (z && t) z.setTransform(t.x, t.y, t.scale, ms === undefined ? 150 : ms);
  }, []);
  var calm = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var view = () => ({ w: live.current.viewW, h: live.current.viewH });
  function zoomTo(scale) {
    var s = state(), L = live.current;
    if (!s || !L.fit) return;
    var next = Math.min(L.maxScale, Math.max(L.minScale, scale));
    go(rescaleAtCenter({ x: s.positionX, y: s.positionY, scale: s.scale }, next, L.content, view()), calm() ? 0 : 150);
  }
  function toFit() { go({ x: 0, y: 0, scale: live.current.fit }, calm() ? 0 : 150); }
  // Centre a mark in the window, keeping the current zoom unless it is below FOCUS_SCALE.
  var centerOn = useCallback((i) => {
    var s = state(), L = live.current, b = boxes[i];
    if (!s || !L.fit || !b) return;
    go(centerTransform(b, L.nat, Math.max(s.scale, Math.min(FOCUS_SCALE, L.maxScale), L.fit), view(), PAD), calm() ? 0 : 150);
  }, [boxes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!apiRef) return undefined;
    apiRef.current = fit ? { centerOn: centerOn, fit: toFit } : null;
    return () => { apiRef.current = null; };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // A plain wheel pans the image and, at an edge, is left alone so the page scrolls on. Ctrl or Cmd with the wheel (and
  // a trackpad pinch, which arrives as Ctrl wheel) is the library's zoom.
  useEffect(() => {
    var el = winRef.current;
    if (!el || !fit) return undefined;
    function wheel(e) {
      if (e.ctrlKey || e.metaKey) return;
      var s = state(), L = live.current;
      if (!s) return;
      var k = e.deltaMode === 1 ? 16 : 1;
      var nx = clampAxis(s.positionX - e.deltaX * k, L.viewW, L.content.w * s.scale);
      var ny = clampAxis(s.positionY - e.deltaY * k, L.viewH, L.content.h * s.scale);
      if (nx === s.positionX && ny === s.positionY) return;
      e.preventDefault();
      go({ x: nx, y: ny, scale: s.scale }, 0);
    }
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [fit]); // eslint-disable-line react-hooks/exhaustive-deps

  function keys(e) {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
    var s = state(), L = live.current;
    if (!s || !L.fit) return;
    var pan = { ArrowUp: [0, 80], ArrowDown: [0, -80], ArrowLeft: [80, 0], ArrowRight: [-80, 0], PageUp: [0, L.viewH * 0.85], PageDown: [0, -L.viewH * 0.85] }[e.key];
    if (e.key === "+" || e.key === "=") zoomTo(s.scale * STEP);
    else if (e.key === "-" || e.key === "_") zoomTo(s.scale / STEP);
    else if (e.key === "0") toFit();
    else if (e.key === "1") zoomTo(1);
    else if (pan) go({ x: clampAxis(s.positionX + pan[0], L.viewW, L.content.w * s.scale), y: clampAxis(s.positionY + pan[1], L.viewH, L.content.h * s.scale), scale: s.scale }, 0);
    else return;
    e.preventDefault();
  }

  // Only a keyboard focus recentres: a mouse click on a mark has its own select-and-scroll.
  function onFocusMark(i, el) {
    var vis = true;
    try { vis = el.matches(":focus-visible"); } catch (err) { vis = true; }
    if (vis) centerOn(i);
  }
  function marks(scale) {
    return notes.map((n, i) => (boxes[i] ? (
      <Mark key={i} n={n} i={i} b={boxes[i]} color={colors[kindOf(n.kind)]} hot={hot} sel={sel} scale={scale} onHot={onHot} onSel={onSel} onFocusMark={onFocusMark} />
    ) : null));
  }

  if (!fit) {
    return (
      <Box component="figure" m={0} p={PAD} ref={winRef}>
        <Box pos="relative">
          <Image src={src} alt={alt} onLoad={(e) => {
            var im = e.currentTarget;
            if (im && im.naturalWidth) setNat({ w: im.naturalWidth, h: im.naturalHeight });
            if (onLoad) onLoad();
          }} />
          {marks(0)}
        </Box>
      </Box>
    );
  }
  var pct = Math.round(cur * 100);
  return (
    <Box component="figure" m={0}>
      <Group gap={6} mb={6} wrap="wrap" role="toolbar" aria-label="Zoom the captured page">
        <Button size="compact-sm" variant="default" aria-label="Zoom in" onClick={() => zoomTo((state() || { scale: fit }).scale * STEP)}>+</Button>
        <Button size="compact-sm" variant="default" aria-label="Zoom out" onClick={() => zoomTo((state() || { scale: fit }).scale / STEP)}>-</Button>
        <Button size="compact-sm" variant="default" aria-label="Fit width" onClick={toFit}>Fit width</Button>
        <Button size="compact-sm" variant="default" aria-label="Zoom to 100%" onClick={() => zoomTo(1)}>100%</Button>
        <Button size="compact-sm" variant="default" aria-label="Reset zoom and selection" onClick={() => { onSel(null); toFit(); }}>Reset</Button>
        <Text size="xs" c="dimmed" aria-live="polite">{"Zoom " + pct + "%"}</Text>
      </Group>
      <Box ref={winRef} h={viewH} tabIndex={0} role="group" aria-label="Captured page. Plus and minus zoom, 0 fits the width, 1 is 100%, arrow keys pan."
        bd="1px solid var(--mantine-color-default-border)" onKeyDown={keys}>
        <TransformWrapper key={fit.toFixed(2)} ref={zref} initialScale={fit} minScale={minScale} maxScale={maxScale}
          limitToBounds centerZoomedOut
          wheel={{ step: 0.15, activationKeys: (k) => k.includes("Control") || k.includes("Meta") }}
          doubleClick={{ disabled: true }} panning={{ velocityDisabled: true }}
          onTransform={(r, s) => setTf((p) => {
            var next = { scale: Math.round(s.scale * 1000) / 1000, x: Math.round(s.positionX), y: Math.round(s.positionY) };
            return p.scale === next.scale && p.x === next.x && p.y === next.y ? p : next;
          })}>
          <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ width: content.w + "px", height: content.h + "px" }}>
            <Box pos="relative" w={content.w} h={content.h} p={PAD}>
              <Box pos="relative" w={nat.w} h={nat.h}>
                <Image src={src} alt={alt} w={nat.w} h={nat.h} maw="none" draggable={false} />
                {marks(cur)}
              </Box>
            </Box>
          </TransformComponent>
        </TransformWrapper>
      </Box>
    </Box>
  );
}
