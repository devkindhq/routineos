// app/pages/Entity.jsx: one record (spec 5.5). A header (breadcrumb, star, Details toggle, More actions), a status
// strip, a Details rail and a main column: Summary, Decision, Comments, Activity and raw fields. Export saves through
// store.saveFile only and a refused save says why; nothing is copied behind the viewer's back. A visit that may not
// write sees no write controls.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon, Alert, Anchor, Badge, Box, Breadcrumbs, Button, Code, Flex, Grid, Group, List, Menu, Modal, Paper, Radio, ScrollArea,
  Stack, Switch, Table, Text, TextInput, Textarea, Timeline, Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconChevronLeft, IconChevronRight, IconDots, IconLayoutSidebar, IconStar, IconStarFilled } from "@tabler/icons-react";
import Gated from "../Gated.jsx";
import { accessReason, canComment, canNativeComment, canWrite, dropRecord, remove, restoreRecord, save, stamp, writeMessage } from "../../core/actions.js";
import { DAY_GROUPS, dayGroup, human } from "../../core/dates.js";
import { commentPath, listComments, nextTs36, saveComment } from "../../core/comments.js";
import { downloadToast, exportSlug_ } from "../../core/exporter.js";
import { HEALTH_LABELS, applyFilters, fieldRenderers, toRow } from "../../core/pages/browse.js";
import {
  DROP_AGAIN_NOTE, KEEP_NOTE, MERGE_NOTE, PERSON_DROP_NOTE, decisionNow, entityIdFromRoute, keepState, mergeChoices, mergeDoc,
  recordSubtitle, sparkPoints,
} from "../../core/pages/entity.js";
import { viewToFilterState } from "../../core/pages/settings.js";
import { readPref, savePref } from "../../core/prefs.js";
import {
  NOTES_SHOW_KEY, REC_ICONS, RECORD_RAIL_KEY, SUMMARY_FIELD_, commentView, recHealth, recPosition, recShown, recType, recordEvents, recordMarkdown,
} from "../../core/record.js";
import { placementOf, sectionsFor } from "../../core/ext.js";
import { stripItems } from "../../core/strip.js";
import { entityHash, entityText, isSafeImageSrc, noteBox, noteKind, producerLabel, recordHref, recordKeys, recordTitle } from "../../core/shared.js";
import Markdown from "../components/Markdown.jsx";
import AnnotatedImage from "../components/AnnotatedImage.jsx";
import { WIDE_MIN, cardTops, focusExcerpt, gutterWidth, leaderPath, placedOrder } from "../components/noteLayout.js";
import { CopyFallback, copyText } from "../Copy.jsx";
import DecisionControl, { KEEP_BADGES, canDecide } from "../DecisionControl.jsx";
import FieldHost from "../FieldHost.jsx";
import { icon } from "../icons.js";
import ExtHost from "../ExtHost.jsx";
import SectionCard, { sectionId } from "../SectionCard.jsx";
import { StateView } from "../States.jsx";
import { LIST_KEY } from "../Keyboard.jsx";
import { toFrameHash } from "../../core/router.js";
import { inFrame, replaceAddress } from "../useRoute.js";
import { useCanDownload, useModel, usePageCtx, useStore } from "../StoreContext.jsx";

var TONE_COLORS = { danger: "red", warning: "yellow", success: "teal" };

function isHttpsUrl(s) {
  return typeof s === "string" && /^https:\/\/[^\s]+$/i.test(s);
}

function personWord(profiles, id, viewer) {
  var p = profiles && Object.prototype.hasOwnProperty.call(profiles, id) ? profiles[id] : null;
  if (p && p.name) return p.name;
  return id === viewer ? "You" : "Someone";
}

// Copy with the clipboard; when it is missing or refuses the write, the text opens selected in a box to copy by hand.
function CopyItem({ value, label, onFallback, done }) {
  function onClick() {
    copyText(value).then((ok) => { if (ok) notifications.show({ message: done || "Copied." }); else onFallback(value); });
  }
  return <Menu.Item onClick={onClick}>{label}</Menu.Item>;
}

function DecisionSection({ ctx, id, noun, d, keep, onSaved }) {
  const [dropOpen, setDropOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  var state = keepState(d, keep);
  var badge = KEEP_BADGES[state];
  var given = keep && keep.reason ? keep.reason : "no reason given";
  var body = {
    dropped: ["Dropped: " + (d.dropReason || "no reason recorded"), "Settings filters dropped this " + noun + ". Keep it to override them for this record."],
    "kept-pending": ["Dropped: " + (d.dropReason || "no reason recorded"), KEEP_NOTE],
    kept: ["Kept by a person" + (keep && keep.at ? ", " + human(keep.at, Date.now(), { style: "sentence" }) : "") + ". Settings filters do not drop this " + noun + "."],
    "drop-pending": [DROP_AGAIN_NOTE],
    "person-dropped": ["Dropped by a person: " + given],
    "person-drop-pending": ["Dropped by a person: " + given, PERSON_DROP_NOTE],
    active: [],
  }[state];
  var canDrop = state === "active" || state === "kept";
  var may = canDecide(ctx);

  function drop() {
    setErr("");
    if (!reason.trim()) { setErr("Give a reason for the drop."); return; }
    setBusy(true);
    dropRecord(ctx, id, reason).then(() => {
      setBusy(false);
      setDropOpen(false);
      setReason("");
      onSaved();
    }, (e) => {
      setBusy(false);
      setErr(writeMessage(e));
    });
  }

  return (
    <Stack gap="xs">
      <Group><Badge color={badge[1]} variant="light">{badge[0]}</Badge></Group>
      <DecisionControl ctx={ctx} id={id} value={decisionNow(state)} decided={!!keep} canDrop={canDrop}
        onDrop={() => setDropOpen(true)} onSaved={onSaved} />
      {body.map((line, i) => <Text key={i} size="sm" c={i ? "dimmed" : undefined}>{line}</Text>)}
      {may && canDrop && dropOpen ? (
        <Stack gap="xs">
          <TextInput label="Reason" aria-label="Reason for the drop" maxLength={200} placeholder={"Why drop this " + noun + "?"}
            value={reason} onChange={(e) => setReason(e.currentTarget.value)} error={err || null} />
          <Group>
            <Button color="red" onClick={drop} loading={busy}>Drop</Button>
            <Button variant="default" onClick={() => { setDropOpen(false); setErr(""); }}>Cancel</Button>
          </Group>
        </Stack>
      ) : null}
    </Stack>
  );
}

function NotesForm({ ctx, id, us, onSaved }) {
  const [tags, setTags] = useState((us.tags || []).join(", "));
  const [note, setNote] = useState(us.note || "");
  const [busy, setBusy] = useState(false);
  function saveNotes() {
    setBusy(true);
    save(ctx.store, ctx.viewer, "userstate/" + id, Object.assign({}, us, {
      tags: tags.split(",").map((x) => x.trim()).filter(Boolean), note: note,
    })).then(() => { setBusy(false); notifications.show({ message: "Notes saved." }); onSaved(); }, (e) => {
      setBusy(false);
      notifications.show({ color: "red", title: "Not saved", message: writeMessage(e) });
    });
  }
  return (
    <Stack gap="xs">
      <TextInput label="Tags, comma separated" value={tags} onChange={(e) => setTags(e.currentTarget.value)} />
      <Textarea label="Note" autosize minRows={3} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      <Group><Button onClick={saveNotes} loading={busy}>Save notes</Button></Group>
    </Stack>
  );
}

// The record fields shown raw, read by name (a literal bySource key here would read as seed data to the page guard).
var RAW_FIELDS = ["bySource", "agentFields"];

function Comments({ ctx, id, docs, profiles, onSaved }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [native, setNative] = useState(null);
  const boxRef = useRef(null);
  var list = commentView(docs, ctx.viewer, Date.now());
  // Desk comments are shared-database writes, so Contributor and up. A Commenter or Viewer sees the box disabled with the reason.
  var ok = canComment(ctx).ok;
  var noAccess = accessReason(ctx);
  // A Commenter cannot write the db, so the platform composer takes the comment when the platform offers one.
  useEffect(() => {
    var live = true;
    canNativeComment(ctx).then((n) => { if (live) setNative(n); });
    return () => { live = false; };
  }, [ctx.store, ctx.canWriteShared]);
  function put(extra) {
    setBusy(true);
    // The path names the author (people/<viewer>/comments), so nobody else's comment can be written or replaced.
    return saveComment(ctx.store, ctx.viewer, commentPath(ctx.viewer, id, nextTs36()),
      Object.assign({ at: new Date().toISOString() }, extra)).then(() => {
      setBusy(false);
      onSaved();
      return true;
    }, (e) => {
      setBusy(false);
      notifications.show({ color: "red", title: "Not saved", message: writeMessage(e) });
      return false;
    });
  }
  // Edit loads the viewer's own comment (inside the 15 minute window commentView allows) into the composer; the
  // next post is a new doc whose edits names the original.
  function post() {
    var t = text.trim().slice(0, 4000);
    put(editing ? { text: t, edits: editing } : { text: t }).then((done) => { if (done) { setText(""); setEditing(null); } });
  }
  return (
    <Stack gap="sm">
      {list.length ? list.map((c) => (
        <Stack key={c.id} gap={2}>
          <Text size="sm" fw={600}>{personWord(profiles, c.by, ctx.viewer)} <Text span size="xs" c="dimmed">{human(c.at, Date.now(), { style: "sentence" })}{c.edited ? ", edited" : ""}{c.verified === false ? ", unverified (written before comments were tied to a person)" : ""}</Text></Text>
          <Text size="sm">{c.text}</Text>
          {ok && c.canEdit ? (
            <Group gap="xs">
              <Button size="compact-xs" variant="subtle" onClick={() => { setEditing(c.id); setText(c.text); }}>Edit comment</Button>
              <Button size="compact-xs" variant="subtle" onClick={() => put({ edits: c.id, deleted: true })}>Delete comment</Button>
            </Group>
          ) : null}
        </Stack>
      )) : <Text size="sm" c="dimmed">No comments yet.</Text>}
      {native ? (
        <Box ref={boxRef}><Button onClick={() => native.open(boxRef.current)}>Comment</Button></Box>
      ) : ok || noAccess ? (
        <Gated reason={noAccess}><Stack gap="xs">
          <Textarea aria-label="Comment" placeholder="Add a comment" autosize minRows={2} maxLength={4000} value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) { e.preventDefault(); post(); } }} />
          <Group>
            <Button disabled={!text.trim()} loading={busy} onClick={post}>{editing ? "Save edit" : "Post comment"}</Button>
            {editing ? <Button variant="default" onClick={() => { setEditing(null); setText(""); }}>Cancel edit</Button> : null}
          </Group>
        </Stack></Gated>
      ) : null}
    </Stack>
  );
}

// Inline SVG line, no axes: the first and last values are stated in the caption (base src/pages/entity.js sparkline).
function Sparkline({ points, label }) {
  var w = 240, h = 48, pad = 4;
  var vs = points.map((p) => p.v);
  var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs), span = hi - lo || 1;
  var step = points.length > 1 ? (w - 2 * pad) / (points.length - 1) : 0;
  var pts = points.map((p, i) => (pad + i * step).toFixed(1) + "," + (h - pad - ((p.v - lo) / span) * (h - 2 * pad)).toFixed(1)).join(" ");
  var now = Date.now();
  return (
    <Stack gap={2} component="figure" m={0}>
      <svg viewBox={"0 0 " + w + " " + h} width={w} height={h} role="img" aria-label={label}>
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2} />
      </svg>
      <Text component="figcaption" size="sm" c="dimmed">{label + ": " + vs[0] + " (" + human(points[0].at, now, { style: "sentence" }) + "), "
        + vs[vs.length - 1] + " (" + human(points[points.length - 1].at, now, { style: "sentence" }) + ")"}</Text>
    </Stack>
  );
}

var TONE_TO_HEALTH = { danger: "red", warning: "yellow", success: "green" };
var NOTE_COLORS = { info: "grape", red: "red", warn: "yellow", ok: "teal" };
var EXCERPT = 150; // characters of a card's text shown until it is picked; the flagged phrase stays inside them
var TOOLBAR_H = 44; // the zoom toolbar above the image window, for the card strip's height cap

// Outlined, numbered marks over a captured image at fractional boxes, and the notes as numbered cards: the number ties a
// mark to its card. The image takes the pane's width in a zoom and pan window; from WIDE_MIN of pane width a narrower card
// strip sits beside it. While the image sits at its fit-width start and every card fits beside it, each card is level with
// its mark and joined to it by a leader line. Otherwise (a tall capture, or zoomed in) the cards list from the top of a
// strip no taller than the window and scroll inside it; a card click centres its mark, a mark click scrolls its card
// into view. Narrower, the cards list under the image and a card click scrolls the image window into view. Show notes off keeps the marks and hides the cards (the text still
// shows on hover, focus and tap), and persists. A note without a usable box is listed under Not placed on the image; it is
// never dropped.
function NoteCard({ n, i, color, hot, sel, top, cardRef, onHot, onPick, onFocusCard }) {
  var on = hot === i || sel === i;
  return (
    <Paper ref={cardRef} role="listitem" id={"image-note-" + i} p="xs" radius="sm" tabIndex={0}
      aria-label={"Note " + (i + 1) + (n.title ? ": " + n.title : "")} aria-current={sel === i ? "true" : undefined}
      pos={top ? "absolute" : undefined} top={top} left={top ? 0 : undefined} right={top ? 0 : undefined}
      bd={"2px solid " + (on ? "var(--mantine-color-" + color + "-filled)" : "var(--mantine-color-default-border)")}
      onMouseEnter={() => onHot(i)} onMouseLeave={() => onHot(null)} onFocus={(e) => { onHot(i); onFocusCard(i, e.currentTarget); }} onBlur={() => onHot(null)}
      onClick={() => onPick(i)}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onPick(i); } }}>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Badge color={color} radius="xl" size="md" px={6} miw="22px" flex="none">{String(i + 1)}</Badge>
        <Stack gap={2} miw={0} flex={1}>
          {n.title ? <Text size="sm" fw={700} lineClamp={sel !== i ? 2 : undefined}>{n.title}</Text> : null}
          <Markdown text={sel === i ? n.text : focusExcerpt(n.text, EXCERPT)} clamp={sel !== i ? 5 : undefined} />
        </Stack>
      </Group>
    </Paper>
  );
}

function ImageNotes({ capture }) {
  const [show, setShow] = useState(() => readPref(NOTES_SHOW_KEY, ["0", "1"], "1") !== "0");
  const [hot, setHot] = useState(null);
  const [sel, setSel] = useState(null);
  const [paneW, setPaneW] = useState(0);
  const [geo, setGeo] = useState(null);
  const [loaded, setLoaded] = useState(0);
  const [view, setView] = useState({ h: 0, atFit: false, zoomable: false });
  const [full, setFull] = useState(false);
  const apiRef = useRef(null);
  const paneRef = useRef(null), rowRef = useRef(null), gutterRef = useRef(null), cardEls = useRef({});
  var notes = capture.notes || [];
  var boxes = useMemo(() => notes.map((n) => noteBox(n.box)), [capture]); // eslint-disable-line react-hooks/exhaustive-deps
  var hasImage = isSafeImageSrc(capture.image);
  var drawn = hasImage && boxes.some(Boolean);
  var cardsShown = show || !drawn;
  var wide = cardsShown && drawn && paneW >= WIDE_MIN;
  // The cards, in order: beside a drawn image only the placed notes, by box top then left; otherwise every note that is
  // not known to have a bad box. The rest are Not placed.
  var listed = hasImage ? placedOrder(boxes) : notes.map((n, i) => i).filter((i) => boxes[i] || !notes[i].box);
  var unplaced = notes.map((n, i) => i).filter((i) => !listed.includes(i));
  var aligned = wide && geo && geo.fits && (view.atFit || !view.zoomable); // an image not yet zoomable is still at its start
  useLayoutEffect(() => {
    var el = paneRef.current;
    if (!el) return undefined;
    function read() { setPaneW(Math.round(el.getBoundingClientRect().width)); }
    read();
    if (typeof ResizeObserver !== "function") return undefined;
    var ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [notes.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  // Measure the marks and the cards, then place each card level with its mark and draw its leader. Anything that cannot
  // be measured leaves no geometry, and the cards simply list from the top.
  useLayoutEffect(() => {
    if (!wide) { setGeo(null); return undefined; }
    var row = rowRef.current;
    if (!row) return undefined;
    function measure() {
      var gut = gutterRef.current, img = row.querySelector("img");
      if (!gut || !img) return setGeo(null);
      var rr = row.getBoundingClientRect(), gr = { left: gut.getBoundingClientRect().left, top: rr.top }, ir = img.getBoundingClientRect();
      if (!ir.height || !rr.width) return setGeo(null);
      var items = [], marks = [];
      for (var k = 0; k < listed.length; k++) {
        var m = row.querySelector('[data-mark="' + listed[k] + '"]'), c = cardEls.current[listed[k]];
        if (!m || !c) return setGeo(null);
        var mr = m.getBoundingClientRect();
        marks.push({ right: mr.right - rr.left, midY: mr.top + mr.height / 2 - rr.top });
        items.push({ y: mr.top - gr.top, h: c.offsetHeight });
      }
      var laid = cardTops(items, ir.bottom - gr.top), leaders = [], tops = {};
      listed.forEach((i, k) => {
        tops[i] = laid.tops[k];
        var lp = leaderPath(marks[k], { left: gr.left - rr.left, top: laid.tops[k] + gr.top - rr.top, h: items[k].h }, ir.right - rr.left);
        leaders.push({ i, d: lp.d, dot: lp.dot });
      });
      var next = { fits: laid.fits, tops, leaders, w: Math.round(rr.width), h: Math.round(rr.height), ih: Math.round(ir.bottom - gr.top) };
      setGeo((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    }
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    var ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [wide, show, capture, loaded, paneW, sel, view.h, view.atFit]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!notes.length) {
    return (
      <Alert color="green" variant="light" title={<Group gap="xs"><Text span fw={600}>Notes</Text><Badge color="green" circle>0</Badge></Group>}>
        Nothing noted. This item is all good.
      </Alert>
    );
  }
  function toggle(on) {
    savePref(NOTES_SHOW_KEY, on ? "1" : "0");
    setShow(on);
  }
  function calm() { return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  // A mark click pins its note and scrolls its card into view (the strip's own scroll, or the page's), reduced motion
  // jumping instead of gliding. A card click pins its note and centres its mark in the zoom window.
  function select(i, fromCard) {
    setSel(i);
    if (i === null) return;
    if (fromCard) {
      if (apiRef.current) apiRef.current.centerOn(i);
      // Stacked under the image, the card is far from its mark: bring the image window into view.
      if (!wide) {
        var win = document.querySelector('[data-mark="' + i + '"]');
        win = win && win.closest('[role="group"]');
        if (win && typeof win.scrollIntoView === "function") win.scrollIntoView({ block: "nearest", behavior: calm() ? "auto" : "smooth" });
      }
      return;
    }
    // After the render, so the card has grown to its full text before it is brought into view.
    requestAnimationFrame(() => {
      var el = document.getElementById("image-note-" + i);
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", behavior: calm() ? "auto" : "smooth" });
    });
  }
  function pick(i) { select(sel === i ? null : i, true); }
  // Only a keyboard focus on a card centres its mark: a mouse click has its own pick.
  function onFocusCard(i, el) {
    var vis = true;
    try { vis = el.matches(":focus-visible"); } catch (err) { vis = true; }
    if (vis && apiRef.current) apiRef.current.centerOn(i);
  }
  var colorOf = (i) => NOTE_COLORS[noteKind(notes[i].kind)];
  var cards = listed.map((i) => (
    <NoteCard key={i} n={notes[i]} i={i} color={colorOf(i)} hot={hot} sel={sel} onHot={setHot} onPick={pick} onFocusCard={onFocusCard}
      top={aligned ? geo.tops[i] + "px" : undefined} cardRef={(el) => { cardEls.current[i] = el; }} />
  ));
  var cardList = wide ? (
    <ScrollArea.Autosize type="auto" mah={view.h ? view.h + TOOLBAR_H : undefined} w={gutterWidth(paneW) + "px"} flex="none">
      <Stack ref={gutterRef} gap="xs" role="list" aria-label="Notes" pos="relative" h={aligned ? geo.ih + "px" : undefined}>{cards}</Stack>
    </ScrollArea.Autosize>
  ) : (
    <Stack ref={gutterRef} gap="xs" role="list" aria-label="Notes" pos="relative">{cards}</Stack>
  );
  var unplacedList = unplaced.length ? (
    <Stack gap={4}>
      <Text size="sm" fw={600}>Not placed on the image</Text>
      <List size="sm">
        {unplaced.map((i) => <List.Item key={i}>{notes[i].title ? <strong>{notes[i].title + " "}</strong> : null}<Markdown text={notes[i].text} /></List.Item>)}
      </List>
    </Stack>
  ) : null;
  var image = hasImage ? (
    <Box flex={wide ? 1 : undefined} miw={0}>
      <AnnotatedImage src={capture.image} alt="Captured page" notes={notes} boxes={boxes} colors={NOTE_COLORS} kindOf={noteKind}
        hot={hot} sel={sel} onHot={setHot} onSel={(i) => select(i, false)} onLoad={() => setLoaded((n) => n + 1)} apiRef={apiRef} onView={setView} />
    </Box>
  ) : null;
  return (
    <Stack gap="sm">
      <Group gap="md">
        <Switch label="Show notes" checked={show} onChange={(e) => toggle(e.currentTarget.checked)} />
        {hasImage ? <Button variant="default" size="xs" onClick={() => setFull(true)}>Show full page</Button> : null}
        {hasImage ? <Text size="sm" c="dimmed">{listed.length + " placed" + (unplaced.length ? ", " + unplaced.length + " not placed" : "")}</Text> : null}
      </Group>
      <Box ref={paneRef}>
        {wide ? (
          <Flex ref={rowRef} pos="relative" gap="md" align="stretch">
            {image}
            {cardList}
            {aligned ? (
              <Box component="svg" aria-hidden="true" pointerEvents="none" width={geo.w} height={geo.h} pos="absolute" top={0} left={0}>
                {geo.leaders.map((l) => {
                  var c = "var(--mantine-color-" + colorOf(l.i) + "-filled)", on = hot === l.i || sel === l.i;
                  return (
                    <g key={l.i}>
                      <Box component="path" c={c} d={l.d} fill="none" stroke="currentColor" strokeWidth={on ? 2.5 : 1.5} opacity={on ? 1 : 0.6} />
                      <Box component="circle" c={c} cx={l.dot.x} cy={l.dot.y} r={on ? 4 : 3} fill="currentColor" />
                    </g>
                  );
                })}
              </Box>
            ) : null}
          </Flex>
        ) : (
          <Stack gap="sm">
            {image}
            {cardsShown ? cardList : null}
          </Stack>
        )}
      </Box>
      {unplacedList}
      {hasImage ? (
        <Modal opened={full} onClose={() => setFull(false)} title="Captured page" size="95%" centered>
          <AnnotatedImage src={capture.image} alt="Captured page, full page" notes={notes} boxes={boxes} colors={NOTE_COLORS} kindOf={noteKind}
            hot={hot} sel={sel} onHot={setHot} onSel={(i) => select(i, false)} />
        </Modal>
      ) : null}
    </Stack>
  );
}

// A hand merge (base mergeSection): merged records link the target with Unmerge; otherwise search the type, pick one,
// choose per differing field, then one write of merges/<id>. Writes only for a visit that may decide.
function MergeSection({ ctx, id, type, t, merge, self, may, onSaved }) {
  const [all, setAll] = useState(null);
  const [term, setTerm] = useState("");
  const [target, setTarget] = useState(null);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  var label = t.label || type;
  function run(p) {
    setBusy(true);
    setErr("");
    p.then(() => { setBusy(false); onSaved(); }, (e) => { setBusy(false); setErr(writeMessage(e)); });
  }
  if (merge) {
    return (
      <Stack gap="xs">
        <Text size="sm" c="dimmed">{MERGE_NOTE}</Text>
        <Text size="sm">Merged by hand into <Anchor href={entityHash(merge.into)}>{merge.into}</Anchor>
          {merge.at ? ", " + human(merge.at, Date.now(), { style: "sentence" }) : ""}</Text>
        {may ? <Group><Button variant="default" loading={busy} onClick={() => run(remove(ctx.store, ctx.viewer, "merges/" + id))}>Unmerge</Button></Group> : null}
        {err ? <Text size="sm" c="red" role="status">{err}</Text> : null}
      </Stack>
    );
  }
  function load() {
    if (all) return;
    ctx.store.list("entities", { where: [["type", "==", type]] }).then(setAll, () => setErr("Could not load records to merge with."));
  }
  var q = term.trim().toLowerCase();
  var hits = all && q ? all.filter((x) => x.id !== id && (x.id.toLowerCase().indexOf(q) !== -1
    || recordTitle(t, x.data).toLowerCase().indexOf(q) !== -1)).slice(0, 10) : [];
  function choose(x) {
    setTarget(x);
    setRows(mergeChoices(t, self, x.data));
  }
  function pick(i, side) {
    setRows((rs) => rs.map((r, j) => (j === i ? Object.assign({}, r, { pick: side }) : r)));
  }
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">{MERGE_NOTE}</Text>
      <TextInput type="search" aria-label={"Find a " + label + " to merge into"} placeholder={"Find a " + label} value={term}
        onFocus={load} onChange={(e) => { setTerm(e.currentTarget.value); setTarget(null); }} />
      {!target ? hits.map((x) => (
        <Group key={x.id} justify="space-between">
          <Stack gap={0}><Text size="sm" fw={600}>{recordTitle(t, x.data)}</Text><Text size="xs" c="dimmed" ff="monospace">{x.id}</Text></Stack>
          <Button size="compact-sm" variant="default" onClick={() => choose(x)}>Merge into this</Button>
        </Group>
      )) : (
        <Stack gap="xs">
          <Text size="sm">Merge into <Anchor href={entityHash(target.id)}>{recordTitle(t, target.data)}</Anchor></Text>
          {rows.length ? rows.map((r, i) => (
            <Radio.Group key={r.field} label={r.label} value={r.pick} onChange={(v) => pick(i, v)}>
              <Group gap="md" mt={4}>
                <Radio value="into" label={"Keep: " + entityText(r.into === undefined ? "" : r.into)} />
                <Radio value="from" label={"Use this record's: " + entityText(r.from)} />
              </Group>
            </Radio.Group>
          )) : <Text size="sm" c="dimmed">No fields differ. The merge keeps the other record's values.</Text>}
          <Group><Button loading={busy} onClick={() => run(save(ctx.store, ctx.viewer, "merges/" + id, mergeDoc(target.id, rows, stamp(ctx))))}>Confirm merge</Button></Group>
        </Stack>
      )}
      {err ? <Text size="sm" c="red" role="status">{err}</Text> : null}
    </Stack>
  );
}

function Activity({ events, profiles, viewer }) {
  const [all, setAll] = useState(false);
  var shown = recShown(events, all);
  var now = Date.now();
  if (!events.length) return <Text size="sm" c="dimmed">Nothing has happened to this record yet.</Text>;
  return (
    <Stack gap="xs">
      {DAY_GROUPS.map((g) => {
        var inGroup = shown.events.filter((e) => dayGroup(e.at, now) === g);
        if (!inGroup.length) return null;
        return (
          <Stack key={g} gap="xs">
            <Title order={3} size="h6" c="dimmed">{g}</Title>
            <Timeline bulletSize={20} lineWidth={2}>
              {inGroup.map((e, i) => {
                var I = icon(REC_ICONS[e.kind]);
                return (
                  <Timeline.Item key={i} bullet={<I size={12} />}>
                    <Text size="sm">{e.parts.map((p, k) => (
                      typeof p === "string" ? <span key={k}>{p}</span>
                        : p.person ? <span key={k}>{personWord(profiles, p.person, viewer)}</span>
                        : p.link ? <Anchor key={k} href={p.link.href}>{p.link.label}</Anchor> : null
                    ))}</Text>
                    <Text size="xs" c="dimmed">{human(e.at, now, { style: "sentence" })}</Text>
                  </Timeline.Item>
                );
              })}
            </Timeline>
          </Stack>
        );
      })}
      {shown.hidden ? <Group><Button size="compact-sm" variant="subtle" onClick={() => setAll(true)}>{"Show " + shown.hidden + " more changes"}</Button></Group> : null}
    </Stack>
  );
}

function Section({ title, children }) {
  return <SectionCard id={sectionId("record", title)} title={title}>{children}</SectionCard>;
}

export default function Entity({ route }) {
  const store = useStore();
  const model = useModel();
  const can = useCanDownload();
  const params = route.params;
  var type = params.type, id = entityIdFromRoute(params), def = model.definition || {};
  var t = recType(def, type), defs = t.fields || {};
  var ctx = usePageCtx();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [rail, setRail] = useState(() => readPref(RECORD_RAIL_KEY, ["0", "1"], "1"));
  const [raw, setRaw] = useState(false);
  const [saveHidden, setSaveHidden] = useState(false);
  const [fallback, setFallback] = useState(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(() => {
    var live = true;
    function list(c, w) { return store.list(c, w ? { where: [w] } : undefined).then(null, () => []); }
    Promise.all([store.get("entities/" + id), store.get("userstate/" + id), store.get("merges/" + id), store.get("decisions/" + id),
      list("views"), list("merges", ["into", "==", id]), list("settingsHistory"), listComments(ctx, id).then(null, () => [])]).then((r) => {
      var d = r[0].exists ? r[0].data : {};
      var ev = recordEvents(d, { id: id, definition: def, decisions: r[3].exists ? [r[3].data] : [],
        merges: (r[2].exists ? [{ id: id, data: r[2].data }] : []).concat(r[5]), settingsHistory: r[6], comments: r[7] });
      var ids = ev.map((e) => e.by).concat(r[7].map((c) => c.data && c.data.by)).filter(Boolean);
      return Promise.resolve(ids.length ? store.profiles(ids) : {}).then(null, () => ({})).then((p) => {
        if (live) { setData({ r: r, ev: ev, profiles: p || {} }); setFailed(false); }
      });
    }).then(null, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [store, ctx, id, attempt]);

  useEffect(() => load(), [load]);

  // Place in the list the record was opened from: read from the explicit filter keys in the address, never from memory.
  var queryKey = JSON.stringify(params.query || {});
  const [pos, setPos] = useState(null);
  useEffect(() => {
    var live = true;
    setPos(null);
    recPosition(ctx, type, id, JSON.parse(queryKey), def).then((p) => { if (live) setPos(p); }, () => {});
    return () => { live = false; };
  }, [ctx, type, id, queryKey, def]);
  // j and k step to the neighbour in that list. The move replaces the address, so Back leaves the list, not each record.
  useEffect(() => {
    function onKey(ev) {
      var what = ev.detail && ev.detail.key, to = pos && (what === "next" ? pos.next : what === "prev" ? pos.prev : null);
      if (!pos || (what !== "next" && what !== "prev")) return;
      ev.preventDefault();
      if (!to) return;
      replaceAddress(recordHref(to, pos.qs));
    }
    window.addEventListener(LIST_KEY, onKey);
    return () => window.removeEventListener(LIST_KEY, onKey);
  }, [pos]);
  var reload = () => setAttempt((a) => a + 1);

  if (failed) {
    return (
      <Stack>
        <Title id="page-title" order={1}>Record</Title>
        <StateView kind="error" collection="this record" onRetry={reload} />
      </Stack>
    );
  }
  if (!data) {
    return (
      <Stack>
        <Title id="page-title" order={1}>Record</Title>
        <StateView kind="loading" label="this record" />
      </Stack>
    );
  }
  var r = data.r;
  if (!r[0].exists) {
    return (
      <Stack>
        <Title id="page-title" order={1}>Not found</Title>
        <Text>{"No " + (t.label || type) + " has the id " + id + ". It may have been merged into another record."}</Text>
      </Stack>
    );
  }
  var d = r[0].data, us = r[1].exists ? r[1].data : {}, keep = r[3].exists ? r[3].data : null;
  var v = d.display || {}, keys = recordKeys(t), title = recordTitle(t, d), subtitle = recordSubtitle(t, d);
  var src = keys.map((k) => (defs[k].type === "url" ? v[k] : null)).filter(isHttpsUrl)[0];
  var write = canWrite(ctx).ok;
  var noAccess = accessReason(ctx);
  var health = recHealth(def, type, v);
  var badge = KEEP_BADGES[keepState(d, keep)];
  var noun = String(t.label || type).toLowerCase();
  // In a frame the page's own address is not one a person can open, so only the address inside the Desk is copied.
  var framed = inFrame();
  var link = framed ? toFrameHash(entityHash(id)) : String(window.location.href).split("#")[0] + entityHash(id);
  var lists = r[4].filter((x) => x.data && x.data.type === type && x.data.state !== "proposed"
    && applyFilters([toRow({ id: id, data: d }, us)], Object.assign(viewToFilterState(x.data), { now: new Date().toISOString() })).length);
  var renderers = fieldRenderers(def, type);
  var pairs = keys.filter((k) => k !== SUMMARY_FIELD_).map((k) => {
    var x = v[k], text = entityText(x);
    return { label: defs[k].label || k, value: x !== undefined && x !== null && x !== "" && Object.prototype.hasOwnProperty.call(renderers, k)
      ? <FieldHost id={renderers[k]} props={{ value: x, record: d, field: k }} store={store} fallback={text} /> : text };
  })
    .concat(health ? [{ label: "Status", value: HEALTH_LABELS[TONE_TO_HEALTH[health.tone]] + ", from "
      + String((defs[def.desk.health[type].field] || {}).label || def.desk.health[type].field) }] : [])
    .concat([{ label: "Seen by", value: (d.sources || []).map((p) => producerLabel(def, p)).join(", ") },
      { label: "First seen", value: d.firstSeen ? human(d.firstSeen, Date.now(), { style: "sentence" }) : "" }]);
  var summary = defs[SUMMARY_FIELD_] && defs[SUMMARY_FIELD_].type === "text" ? entityText(v[SUMMARY_FIELD_]) : "";
  var sparks = keys.filter((k) => defs[k].type === "number").map((k) => ({ k: k, label: defs[k].label || k, pts: sparkPoints(d.sightings, k) }))
    .filter((x) => x.pts.length > 1);
  var merge = r[2].exists ? r[2].data : null, mayMerge = canDecide(ctx);
  var mayRestore = mayMerge && ["dropped", "person-dropped", "person-drop-pending"].indexOf(keepState(d, keep)) !== -1;

  function toggleRail() {
    var next = rail === "0" ? "1" : "0";
    savePref(RECORD_RAIL_KEY, next);
    setRail(next);
  }
  function star() {
    save(store, model.viewer, "userstate/" + id, Object.assign({}, us, { star: !us.star })).then(reload, (e) => {
      notifications.show({ color: "red", title: "Not saved", message: writeMessage(e) });
    });
  }
  // Restore: a person's own drop is removed; a record the routine dropped is kept (core/actions.js restoreRecord).
  function restore() {
    restoreRecord(ctx, id, keep).then(() => {
      notifications.show({ message: "Restored " + title + ". Applies from the next run." });
      reload();
    }, (e) => {
      notifications.show({ color: "red", title: "Not saved", message: writeMessage(e) });
    });
  }
  function exportMd() {
    var name = exportSlug_(title, "record") + ".md";
    Promise.resolve().then(() => store.saveFile(name, recordMarkdown(d, def))).then(() => {
      notifications.show({ message: "Saved " + name + "." });
    }, (err) => {
      var tt = downloadToast(err);
      if (tt.hide) setSaveHidden(true);
      notifications.show({ color: tt.tone === "quiet" ? "gray" : tt.tone === "fail" ? "red" : "yellow", message: tt.text });
    });
  }

  var extSections = sectionsFor(typeof window !== "undefined" ? window.DESK_EXTENSIONS : null, type);
  var extAt = (where) => extSections.filter((e) => placementOf(e) === where).map((e) => (
    <Section key={e.id} title={e.title || e.id}>
      <ExtHost id={e.id} props={{ type: type, id: id, record: d }} fallback={<Text size="sm" c="dimmed">This section could not be shown.</Text>} />
    </Section>
  ));
  var railBox = rail === "0" ? null : (
    <Stack component="aside" aria-label="Details" gap="md">
      <Section title="Details">
        <Table>
          <Table.Tbody>
            {pairs.map((p) => (
              <Table.Tr key={p.label}>
                <Table.Th scope="row">{p.label}</Table.Th>
                <Table.Td>{p.value || <Text span c="dimmed">None</Text>}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Section>
      <Section title="Lists">
        {lists.length ? (
          <Stack gap={4}>
            {lists.map((x) => <Anchor key={x.id} href={"#/browse/" + encodeURIComponent(type) + "?view=" + encodeURIComponent(x.id)}>{x.data.name || x.id}</Anchor>)}
          </Stack>
        ) : <Text size="sm" c="dimmed">In no saved lists</Text>}
      </Section>
      <Section title="Yours">
        {write || noAccess ? <Gated reason={noAccess}><NotesForm ctx={ctx} id={id} us={us} onSaved={reload} /></Gated> : (
          <Stack gap={4}>
            <Text size="sm">{(us.tags || []).length ? "Tags: " + us.tags.join(", ") : "No tags"}</Text>
            {us.note ? <Text size="sm">{us.note}</Text> : null}
          </Stack>
        )}
        {(d.links || []).length ? (
          <Stack gap={4} mt="sm">
            {d.links.map((l) => <Anchor key={l.id} href={entityHash(l.id)}>{l.key || l.id}</Anchor>)}
          </Stack>
        ) : null}
      </Section>
    </Stack>
  );

  return (
    <Stack gap="md">
      <Breadcrumbs>
        <Anchor href={"#/browse/" + encodeURIComponent(type) + (pos && pos.qs ? "?" + String(pos.qs).replace(/^\?/, "") : "")}>{t.plural || t.label || type}</Anchor>
        <Text>{title}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Stack gap={4} miw={0}>
          <Title id="page-title" order={1}>{title}</Title>
          {subtitle ? <Text c="dimmed">{subtitle}</Text> : null}
        </Stack>
        <Group gap="xs" wrap="nowrap">
          {write || noAccess ? (
            <Gated reason={noAccess} inline><ActionIcon variant="subtle" onClick={star} aria-label={(us.star ? "Unstar " : "Star ") + title} aria-pressed={!!us.star}>
              {us.star ? <IconStarFilled size={18} /> : <IconStar size={18} />}
            </ActionIcon></Gated>
          ) : null}
          <Button variant="default" leftSection={<IconLayoutSidebar size={16} />} onClick={toggleRail} aria-pressed={rail !== "0"}>Details</Button>
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="default" size="lg" aria-label="More actions"><IconDots size={18} /></ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <CopyItem value={link} label="Copy link" onFallback={setFallback}
                done={framed ? "Copied the end of the address (the part after #). Put it after the web address of this page." : undefined} />
              {can === true && !saveHidden ? <Menu.Item onClick={exportMd}>Export record as Markdown</Menu.Item> : null}
              {src ? <Menu.Item component="a" href={src} target="_blank" rel="noopener noreferrer">Open source url</Menu.Item> : null}
              {mayRestore ? <Menu.Item onClick={restore}>Restore</Menu.Item> : null}
              {mayMerge && !merge ? <Menu.Item onClick={() => setMergeOpen(true)}>Merge with another record</Menu.Item> : null}
              <Menu.Item onClick={() => setRaw((x) => !x)}>{raw ? "Hide raw fields" : "Show raw fields"}</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      {pos ? (
        <Group gap="xs">
          <Text size="sm" c="dimmed">{(pos.index + 1) + " of " + pos.total + " in " + pos.label}</Text>
          {pos.prev ? <Anchor size="sm" href={recordHref(pos.prev, pos.qs)} aria-label="Previous in list"><Group gap={2} component="span"><IconChevronLeft size={14} />Previous</Group></Anchor> : null}
          {pos.next ? <Anchor size="sm" href={recordHref(pos.next, pos.qs)} aria-label="Next in list"><Group gap={2} component="span">Next<IconChevronRight size={14} /></Group></Anchor> : null}
        </Group>
      ) : null}
      <Group gap="xs">
        {stripItems(Object.assign({}, d, { type: type }), keep, def).map((x) => {
          if (x.key === "state") return <Badge key={x.key} color={TONE_COLORS[x.value]} variant="light">{x.label}</Badge>;
          if (x.key === "decision") return <Badge key={x.key} color={KEEP_BADGES[x.value][1]} variant="light">{KEEP_BADGES[x.value][0]}</Badge>;
          if (x.key === "type") return <Badge key={x.key} variant="outline">{x.label}</Badge>;
          if (x.key === "notes" || x.key.indexOf("field:") === 0) return <Badge key={x.key} variant="light" color="gray">{x.label}</Badge>;
          return <Text key={x.key} size="sm" c="dimmed">{x.label}</Text>;
        })}
      </Group>
      {d.capture ? <Section title="Captured page"><ImageNotes capture={d.capture} /></Section> : null}
      <Grid>
        <Grid.Col span={{ base: 12, md: railBox ? 8 : 12 }}>
          <Stack gap="md">
            {extAt("top")}
            {summary || sparks.length ? (
              <Section title="Summary">
                <Stack gap="sm">
                  {summary ? <Text>{summary}</Text> : null}
                  {sparks.map((x) => <Sparkline key={x.k} points={x.pts} label={x.label} />)}
                </Stack>
              </Section>
            ) : null}
            {extAt("after-summary")}
            <Section title="Decision">
              <DecisionSection ctx={ctx} id={id} noun={noun} d={d} keep={keep} onSaved={reload} />
            </Section>
            {extAt("after-fields")}
            <Section title="Comments">
              <Comments ctx={ctx} id={id} docs={r[7]} profiles={data.profiles} onSaved={reload} />
            </Section>
            <Section title="Activity">
              <Activity events={data.ev} profiles={data.profiles} viewer={model.viewer} />
            </Section>
            {merge || (mergeOpen && mayMerge) ? (
              <Section title="Merge">
                <MergeSection ctx={ctx} id={id} type={type} t={t} merge={merge} self={d} may={mayMerge} onSaved={reload} />
              </Section>
            ) : null}
            {raw ? (
              <Section title="Raw fields">
                <Code block>{JSON.stringify(Object.fromEntries([["id", id], ["key", d.key]].concat(RAW_FIELDS.map((f) => [f, d[f] || {}]))), null, 2)}</Code>
              </Section>
            ) : null}
          </Stack>
        </Grid.Col>
        {railBox ? <Grid.Col span={{ base: 12, md: 4 }}>{railBox}</Grid.Col> : null}
      </Grid>
      <CopyFallback value={fallback} onClose={() => setFallback(null)} />
    </Stack>
  );
}
