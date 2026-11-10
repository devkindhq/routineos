// app/pages/Browse.jsx: one list per entity type (#/browse/<type>) and per view module (#/m/<id>), on
// mantine-datatable. Filter, sort, columns and calculations live in the hash query (core/pages/browse.js), written
// with replaceState so typing never adds history. A module's fixed scope is applied but never written to the hash.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, Alert, Anchor, Badge, Button, Group, Menu, NativeSelect, Pagination, Popover, SegmentedControl, Stack, Text, TextInput, Title } from "@mantine/core";
import { DataTable } from "mantine-datatable";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconColumns3, IconDeviceFloppy, IconDownload, IconFilter, IconLayoutList, IconPlus, IconSearch, IconStar, IconStarFilled, IconX } from "@tabler/icons-react";
import Gated from "../Gated.jsx";
import { loadCols, resetCols, saveCols } from "../../core/viewerstate.js";
import { accessReason, byId, canWrite, save, stamp, watchAll, writeMessage } from "../../core/actions.js";
import { watchComments } from "../../core/comments.js";
import { human } from "../../core/dates.js";
import { exportScope } from "../../core/exporter.js";
import { ownerOf } from "../../core/members.js";
import { keepState } from "../../core/pages/entity.js";
import { FULL_READ_MAX, FULL_STEP, PAGE_SIZE, fullRead, nextPage, pageQuery } from "../../core/paging.js";
import { moduleFor } from "../../core/palette.js";
import {
  BROWSE_DEFAULT_SORT, BROWSE_STATUSES, CALC_FNS, CHANGE_SETTLE_MS, EXTRA_COLS, applyFilters, browseColumns, browseText, calcValue, chipSource, commentCounts, countLine,
  decisionLabel, defaultCols, fieldRenderers, filterChips, HEALTH_LABELS, HEALTH_TONES, healthOf, moduleStartState, notGreenCount, notGreenLine, needsFullRead, overlayRow, pagedBase, parseCalc, readFilterState,
  removeChip, rowValue, scopeChips, scopeOf, toRow, userstateAfter, writeFilterState,
} from "../../core/pages/browse.js";
import { canEditView, isModified, viewByName, viewDoc, viewToFilterState } from "../../core/pages/settings.js";
import { commentView } from "../../core/record.js";
import { producerLabel, recordHref, recordTitle } from "../../core/shared.js";
import BulkBar from "../BulkBar.jsx";
import ExportModal from "../ExportModal.jsx";
import FieldHost from "../FieldHost.jsx";
import Filters from "../Filters.jsx";
import { LIST_KEY, SEARCH_KEY } from "../Keyboard.jsx";
import Peek from "../Peek.jsx";
import { failToast } from "../settings/common.jsx";
import { StateView } from "../States.jsx";
import { useModel, usePageCtx, useSetPageCommands, useStore } from "../StoreContext.jsx";
import { canonicalHash } from "../../core/router.js";
import { go, replaceAddress, replaceParams } from "../useRoute.js";

var DATE_COLS = ["lastSeen", "firstSeen", "capturedAt"];
var NARROW_HIDDEN = ["notes", "commentCount"];
var NARROW_QUERY = "(min-width: 48em)";
var EDITED_KEY = "edited";

function has(o, k) {
  return !!o && Object.prototype.hasOwnProperty.call(o, k);
}

// The columns a list shows before the viewer picks: the legacy preview's order.
function defaultShown(all, rows, health) {
  var keys = defaultCols(all).filter((k) => k !== "lastSeen");
  if (health && health.kind === "health" && keys.indexOf(health.field) === -1) keys.push(health.field);
  if (rows.some((r) => r.notes)) keys.push("notes");
  keys.push("decision", "owner");
  keys.push(rows.some((r) => r.capturedAt) ? "capturedAt" : "lastSeen");
  keys.push("commentCount");
  return keys;
}

function cellText(key, v) {
  if (DATE_COLS.indexOf(key) !== -1) return v ? human(v, Date.now()) : "";
  return browseText(v);
}

export default function Browse({ route }) {
  const model = useModel();
  var def = model.definition;
  var isModule = route.page === "module";
  var m = isModule ? moduleFor(def, route.params.id) : null;
  var type = isModule ? (m ? m.view.type : null) : route.params.type;
  var t = type && has(def.types, type) ? def.types[type] : null;
  if (!t) {
    return (
      <Stack>
        <Title id="page-title" order={1}>Browse</Title>
        <Text>{isModule ? "This workspace has no view called " + route.params.id + "." : "This workspace has no type called " + type + "."}</Text>
      </Stack>
    );
  }
  return <BrowseList key={(m ? "m:" + m.id : "t:") + type} route={route} type={type} t={t} module={m} />;
}

function BrowseList({ route, type, t, module: m }) {
  const store = useStore();
  const model = useModel();
  var def = model.definition;
  var ctx = usePageCtx();
  var plural = t.plural || type;
  var query = route.params.query || {};
  var peekId = query.peek || "";
  var queryKey = JSON.stringify(Object.keys(query).filter((k) => k !== "peek" && k !== "view").sort().map((k) => [k, query[k]]));
  // ?view=<id> opens a saved or built-in view of this type. A module page ignores it; its own view seeds the filters.
  var viewId = m ? "" : query.view || "";
  const [viewState, setViewState] = useState(null);
  useEffect(() => {
    if (!viewId || (viewState && viewState.id === viewId)) return undefined;
    var live = true;
    var builtIn = (def.views || []).filter((v) => v.id === viewId && v.type === type)[0];
    var got = builtIn ? Promise.resolve({ exists: true, data: builtIn }) : store.get("views/" + viewId);
    got.then((doc) => {
      if (!live) return;
      var ok = doc && doc.exists && doc.data && doc.data.type === type;
      setViewState({ id: viewId, data: ok ? doc.data : null, builtIn: !!builtIn, note: ok ? "" : "That view no longer exists." });
    }, () => { if (live) setViewState({ id: viewId, data: null, builtIn: false, note: "Could not read that view." }); });
    return () => { live = false; };
  }, [viewId, viewState, def, type, store]);
  var viewReady = !viewId || !!(viewState && viewState.id === viewId);
  var viewDocData = viewReady && viewId && viewState.data ? viewState.data : null;

  var fs = useMemo(() => {
    var q = JSON.parse(queryKey);
    if (m && !q.length) return moduleStartState(m);
    // Only ?view= in the hash: the view's stored filters. Any other key (edited=1 at least) means the view was
    // edited, so the hash wins.
    if (viewDocData && !q.length) return viewToFilterState(viewDocData);
    var o = {};
    q.forEach((p) => { o[p[0]] = p[1]; });
    return readFilterState(o);
  }, [queryKey, m, viewDocData]);
  var health = useMemo(() => chipSource(def, type), [def, type]);
  // Every record link carries the list state as explicit keys (a saved view is expanded), so the record knows its place.
  var recQuery = useMemo(() => writeFilterState(fs), [fs]);

  const [docs, setDocs] = useState(null);
  const [first, setFirst] = useState(null);
  const [people, setPeople] = useState(null);
  const [error, setError] = useState(null);
  const [fullError, setFullError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [changed, setChanged] = useState(0);
  // The list holds every record of the type, read in full (core/paging.js fullRead), up to FULL_STEP * FULL_READ_MAX
  // documents; past that cap the page says so. A change to the type's newest records (the base live query) reads the
  // set again; the first answer is the subscription starting, not a change.
  useEffect(() => {
    var live = true;
    setFullError(null);
    fullRead(store, "entities", { where: [["type", "==", type]] }).then((d) => { if (live) setDocs(d); },
      (e) => { if (live) setFullError(e); });
    return () => { live = false; };
  }, [store, type, attempt, changed]);
  // Until the full read lands, the first PAGE_SIZE records in the list's sort come from one keyset page read
  // (pageQuery) over the status, reason and window filters (pagedBase), so a large type paints at once. Only a list the store can sort itself (needsFullRead false) gets
  // it; search, filters, counts and calculations wait for the full read. A failed page read leaves the full read to
  // answer, and its failure is shown.
  var scope = useMemo(() => (m ? scopeOf(m) : null), [m]);
  var pageable = !needsFullRead(Object.assign({}, fs, { scope: scope }));
  var pageKey = [fs.status, fs.reason || "", fs.window || "", fs.sort.field, fs.sort.dir].join(":");
  var waiting = docs === null;
  useEffect(() => {
    if (!waiting || !pageable) return undefined;
    var live = true;
    nextPage(store, "entities", pagedBase(type, fs), fs.sort, null).then((p) => {
      if (live) setFirst({ key: pageKey, docs: p.rows, done: p.done });
    }, () => { /* the full read answers instead */ });
    return () => { live = false; };
  }, [store, type, waiting, pageable, pageKey]);
  var shownDocs = docs || (pageable && first && first.key === pageKey ? first.docs : null);
  var partial = !docs && !!shownDocs;
  // Changes that land within CHANGE_SETTLE_MS of each other (a run writing many records) re-read the list once.
  useEffect(() => {
    var first = true, timer = null;
    var stop = store.subscribe("entities", () => {
      if (first) { first = false; return; }
      clearTimeout(timer);
      timer = setTimeout(() => setChanged((n) => n + 1), CHANGE_SETTLE_MS);
    }, Object.assign(pageQuery({ where: [["type", "==", type]] }, BROWSE_DEFAULT_SORT, null), { onError: function () {} }));
    return () => { clearTimeout(timer); stop(); };
  }, [store, type]);
  useEffect(() => {
    var live = true;
    setError(null);
    var stop = watchAll(ctx, {
      userstate: { collection: "userstate" }, columns: { collection: "columns" },
      decisions: { collection: "decisions" }, comments: { watch: (cb, onError) => watchComments(ctx, cb, onError) },
    }, (got) => { if (live) setPeople(Object.assign({}, got)); }, (e) => { if (live) setError(e); });
    return () => { live = false; stop(); };
  }, [store, ctx, type, attempt]);

  // A star the viewer just saved shows at once, before (or without) the userstate watch answering again. The overlay
  // holds only until the watch answers next: from then on the watch is the record, so a later write (a bulk Tag, a
  // change from elsewhere) is never hidden behind it.
  const [ownUs, setOwnUs] = useState({ people: null, docs: {} });
  var us = useMemo(() => Object.assign(byId(people && people.userstate), ownUs.people === people ? ownUs.docs : {}), [people, ownUs]);
  var decided = useMemo(() => byId(people && people.decisions), [people]);
  var rows = useMemo(() => {
    if (!shownDocs || !people || !viewReady) return null;
    var counts = commentCounts(people.comments);
    return shownDocs.map((d) => {
      var r = overlayRow(toRow(d, us[d.id]), decided[d.id]);
      r.commentCount = counts[d.id] || 0;
      r.decision = decisionLabel(decided[d.id]);
      var owner = ownerOf(d.id, decided, people.comments);
      r.owner = owner ? owner.id : "";
      return r;
    });
  }, [shownDocs, people, us, decided, viewReady]);
  var names = useMemo(() => {
    var out = {};
    (shownDocs || []).forEach((d) => { out[d.id] = recordTitle(t, d.data || {}); });
    return out;
  }, [shownDocs, t]);

  // The viewer's own column choice for this type (null: none yet). The address and a saved view come first.
  const [personalCols, setPersonalCols] = useState(null);
  // Set once the viewer toggles or resets: a slower load of the saved choice must not replace it.
  const colsTouched = useRef(false);
  useEffect(() => {
    var live = true;
    setPersonalCols(null);
    colsTouched.current = false;
    loadCols(ctx, type).then((v) => { if (live && !colsTouched.current) setPersonalCols(v); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.store, ctx.viewer, type]);

  var allCols = useMemo(() => {
    var cols = browseColumns(t, people ? people.columns : [], type);
    Object.keys(EXTRA_COLS).forEach((k) => { if (!cols.some((c) => c.key === k)) cols.push({ key: k, label: EXTRA_COLS[k], extra: true }); });
    return cols;
  }, [t, people, type]);
  var colByKey = useMemo(() => {
    var o = {};
    allCols.forEach((c) => { o[c.key] = c; });
    return o;
  }, [allCols]);
  var chosenCols = fs.cols || personalCols;
  var shownKeys = (chosenCols ? chosenCols.filter((k) => has(colByKey, k)) : defaultShown(allCols, rows || [], health));
  if (!shownKeys.length) shownKeys = defaultShown(allCols, rows || [], health);
  var shownCols = shownKeys.map((k) => colByKey[k]);

  var filtered = useMemo(() => {
    if (!rows) return [];
    var run = Object.assign({}, fs, { scope: scope, healthRule: health && health.kind === "health" ? health.rule : null });
    return applyFilters(rows, run);
  }, [rows, fs, scope, health]);

  var writeHash = useCallback((next) => {
    var base = m ? "#/m/" + encodeURIComponent(m.id) : "#/browse/" + encodeURIComponent(type);
    var qs = writeFilterState(next);
    // On a view or module page the hash says the filters were edited, so a state equal to the Browse defaults is
    // read as written and not as the view's stored filters.
    if (m || viewDocData) qs = EDITED_KEY + "=1" + (qs ? "&" + qs : "");
    if (viewDocData) qs = "view=" + encodeURIComponent(viewId) + (qs ? "&" + qs : "");
    var h = base + (qs ? "?" + qs : "");
    if (h !== canonicalHash(window.location.hash)) replaceAddress(h);
  }, [m, type, viewDocData, viewId]);

  // Search keeps its own text so the caret never jumps; the hash follows each keystroke.
  const [search, setSearch] = useState(fs.q || "");
  useEffect(() => { setSearch(fs.q || ""); }, [fs.q]);

  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [queryKey]);
  var pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  var shownPage = Math.min(page, pageCount);
  var records = filtered.slice((shownPage - 1) * PAGE_SIZE, shownPage * PAGE_SIZE);

  const [selIds, setSelIds] = useState(() => new Set());
  // True once Select all matching chose every filtered row; a bulk change then asks first (BulkBar).
  const [allMatching, setAllMatching] = useState(false);
  var selected = filtered.filter((r) => selIds.has(r.id));

  const [filtersOpen, setFiltersOpen] = useState(false);
  const openFilters = useCallback(() => setFiltersOpen(true), []);
  const [exportOpen, setExportOpen] = useState(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcField, setCalcField] = useState("");
  const [calcFn, setCalcFn] = useState("count");
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [viewList, setViewList] = useState(null);
  const nameRef = useRef(null);
  const setPageCommands = useSetPageCommands();
  var may = canWrite(ctx).ok;
  var noAccess = accessReason(ctx);

  // A ?peek= naming a record that is not in the list goes away once every row is known (not on the first page).
  var peekRow = peekId ? filtered.find((r) => r.id === peekId) || null : null;
  useEffect(() => {
    if (rows && !partial && peekId && !peekRow) replaceParams({ peek: null });
  }, [rows, partial, peekId, peekRow]);

  // j and k move a cursor over the rows shown and focus the row's link; o opens the peek there. With the peek open,
  // j and k walk the peek and o opens the full record. / focuses the search box (base listKey and search key).
  const boxRef = useRef(null);
  const searchRef = useRef(null);
  const cursor = useRef(-1);
  const keys = useRef(null);
  keys.current = { query: recQuery, records: records, ids: filtered.map((r) => r.id), peekId: peekRow ? peekRow.id : "" };
  useEffect(() => {
    function focusRow(id) {
      var box = boxRef.current, h = recordHref(id, keys.current.query);
      var a = box ? Array.prototype.find.call(box.querySelectorAll("a"), (x) => x.getAttribute("href") === h) : null;
      if (a) a.focus();
    }
    function onList(ev) {
      var k = keys.current, what = ev.detail && ev.detail.key;
      if (k.peekId) {
        var i = k.ids.indexOf(k.peekId);
        if (what === "open") go(recordHref(k.peekId, k.query));
        else if (what === "next" && i < k.ids.length - 1) replaceParams({ peek: k.ids[i + 1] });
        else if (what === "prev" && i > 0) replaceParams({ peek: k.ids[i - 1] });
        ev.preventDefault();
        return;
      }
      if (!k.records.length) return;
      ev.preventDefault();
      if (what === "open") {
        if (cursor.current >= 0 && k.records[cursor.current]) replaceParams({ peek: k.records[cursor.current].id });
        return;
      }
      cursor.current = Math.max(0, Math.min(k.records.length - 1, cursor.current + (what === "prev" ? -1 : 1)));
      focusRow(k.records[cursor.current].id);
    }
    function onSearch(ev) {
      if (!searchRef.current) return;
      ev.preventDefault();
      searchRef.current.focus();
    }
    window.addEventListener(LIST_KEY, onList);
    window.addEventListener(SEARCH_KEY, onSearch);
    return () => {
      window.removeEventListener(LIST_KEY, onList);
      window.removeEventListener(SEARCH_KEY, onSearch);
    };
  }, []);
  useEffect(() => { cursor.current = -1; }, [queryKey, shownPage]);

  var renderers = useMemo(() => fieldRenderers(def, type), [def, type]);
  var sourceLabel = useCallback((id) => producerLabel(def, id), [def]);

  var readFailed = !!(error || (fullError && !partial));

  // Saving a view stores the current filters; saving over a view keeps who made it (viewDoc). Only the creator
  // updates a view (canEditView); anyone who can write saves a new one. The saved doc becomes the open view here, so
  // nothing is read back.
  var onView = !!viewDocData && !(viewState && viewState.builtIn);
  var editable = onView && canEditView(viewDocData, model.viewer);
  function openSave(select) {
    setViewName(onView ? viewDocData.name || "" : "");
    setSaveError("");
    if (select !== undefined) {
      setSaveOpen(true);
      // Rename: the name field is ready to type over once the dialog has painted.
      if (select) setTimeout(() => { if (nameRef.current) { nameRef.current.focus(); nameRef.current.select(); } }, 0);
    } else setSaveOpen((o) => !o);
  }
  function saveView(id, base, asName) {
    var n = (asName === undefined ? viewName : asName).trim();
    if (!n) { setSaveError("Name the view first."); return; }
    var st = stamp(ctx);
    var doc = viewDoc(fs, { type: type, name: n, base: base, at: st.at, by: st.by });
    setSaving(true);
    save(store, model.viewer, "views/" + id, doc).then(() => {
      setSaving(false);
      setSaveOpen(false);
      setViewState({ id: id, data: doc, builtIn: false, note: "" });
      var qs = writeFilterState(fs);
      var h = "#/browse/" + encodeURIComponent(type) + "?view=" + encodeURIComponent(id) + (qs ? "&" + qs : "");
      replaceAddress(h);
      notifications.show({ message: "Saved view " + n + "." });
    }, (e) => { setSaving(false); failToast(e); });
  }
  // The view menu reads this type's saved views when it opens; built-in views come from the definition.
  function loadViews() {
    var builtIn = (def.views || []).filter((v) => v.type === type).map((v) => ({ id: v.id, data: v, builtIn: true }));
    store.list("views", { where: [["type", "==", type]] }).then((got) => {
      setViewList(builtIn.concat(got.map((d) => ({ id: d.id, data: d.data, builtIn: false }))).sort(viewByName));
    }, () => setViewList(builtIn.sort(viewByName)));
  }
  var modified = !!viewDocData && isModified(viewDocData, fs);
  // The palette's commands for this list (spec "Command palette": save, update, rename a view). A ref keeps
  // each command on this render's filters without re-registering on every change.
  var cmds = useRef(null);
  cmds.current = { openSave: openSave, update: () => saveView(viewId, viewDocData, viewDocData.name || "") };
  var viewLabel = viewDocData ? viewDocData.name || viewId : "";
  useEffect(() => {
    if (!may || m || readFailed) return undefined;
    var list = [{ id: "view:save", label: "Save view as new", run: () => cmds.current.openSave(false) }];
    if (editable) {
      list.push({ id: "view:update", label: "Update view " + viewLabel, run: () => cmds.current.update() });
      list.push({ id: "view:rename", label: "Rename view " + viewLabel, run: () => cmds.current.openSave(true) });
    }
    setPageCommands(list);
    return () => setPageCommands([]);
  }, [may, m, readFailed, editable, viewLabel, setPageCommands]);
  if (readFailed) {
    var failed = error || fullError;
    return (
      <Stack>
        <Title id="page-title" order={1}>{m ? m.label || m.id : plural}</Title>
        <StateView kind="error" collection={plural} message={String((failed && failed.message) || failed)}
          onRetry={() => setAttempt((n) => n + 1)} />
      </Stack>
    );
  }
  function freshId() { return "v-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function toggleStar(r) {
    var next = userstateAfter(us[r.id], r.star ? "unstar" : "star");
    save(store, model.viewer, "userstate/" + r.id, next).then(() => {
      setOwnUs((o) => ({ people: people, docs: Object.assign({}, o.people === people ? o.docs : {}, { [r.id]: next }) }));
    }, failToast);
  }

  var calcs = parseCalc(fs.calc, allCols.map((c) => c.key));
  function setCalcs(list) {
    writeHash(Object.assign({}, fs, { calc: list.map((c) => c.field + ":" + c.fn).join(",") }));
  }
  function addCalc() {
    var field = calcField || (shownCols[0] && shownCols[0].key);
    if (!field) return;
    var next = calcs.filter((c) => !(c.field === field && c.fn === calcFn)).concat([{ field: field, fn: calcFn }]);
    setCalcs(next);
    setCalcOpen(false);
  }
  function toggleCol(key) {
    var next = shownKeys.indexOf(key) === -1 ? shownKeys.concat([key]) : shownKeys.filter((k) => k !== key);
    if (!next.length) return;
    colsTouched.current = true;
    // Back to exactly the defaults is not a choice: keeping no list lets later data-driven defaults show.
    var def = defaultShown(allCols, rows || [], health);
    if (next.length === def.length && next.every((k) => def.indexOf(k) !== -1)) {
      setPersonalCols(null);
      resetCols(ctx, type).catch((e) => notifications.show({ message: writeMessage(e) }));
      writeHash(Object.assign({}, fs, { cols: null }));
      return;
    }
    setPersonalCols(next);
    saveCols(ctx, type, next);
    writeHash(Object.assign({}, fs, { cols: next }));
  }
  function resetColumns() {
    colsTouched.current = true;
    setPersonalCols(null);
    resetCols(ctx, type).catch((e) => notifications.show({ message: writeMessage(e) }));
    writeHash(Object.assign({}, fs, { cols: null }));
  }
  function exportRows(list) {
    return list.map((r) => {
      var o = {};
      shownCols.forEach((c) => {
        var v = rowValue(r, c.key);
        o[c.key] = v !== null && typeof v === "object" && !Array.isArray(v) ? browseText(v) : v;
      });
      return o;
    });
  }

  var columns = shownCols.map((c, i) => ({
    accessor: c.key,
    title: c.label,
    sortable: true,
    visibleMediaQuery: NARROW_HIDDEN.indexOf(c.key) !== -1 ? NARROW_QUERY : undefined,
    render: (r) => {
      var v = rowValue(r, c.key);
      var text = cellText(c.key, v);
      if (i === 0) {
        var title = text || names[r.id] || r.id;
        var anchorEl = <Anchor href={recordHref(r.id, recQuery)} onClick={(e) => e.stopPropagation()}>{title}</Anchor>;
        var badge = overlayBadge(r);
        var link = badge ? <Group gap={6} wrap="nowrap">{anchorEl}{badge}</Group> : anchorEl;
        if (!may && !noAccess) return link;
        return (
          <Group gap={4} wrap="nowrap">
            <Gated reason={noAccess} inline>
              <ActionIcon size="sm" variant="subtle" color={r.star ? "yellow" : "gray"} aria-pressed={r.star ? "true" : "false"}
                aria-label={(r.star ? "Unstar " : "Star ") + title} onClick={(e) => { e.stopPropagation(); toggleStar(r); }}>
                {r.star ? <IconStarFilled size={14} /> : <IconStar size={14} />}
              </ActionIcon>
            </Gated>
            {link}
          </Group>
        );
      }
      if (has(renderers, c.key) && v !== undefined && v !== null) {
        return <FieldHost id={renderers[c.key]} props={{ value: v, record: r, field: c.key }} store={store} fallback={text} />;
      }
      return text;
    },
  }));

  // Status, then health or choice pills. Counts show once every row is known; a source pill counts the rows the
  // other filters leave. Counting filters the rows per value, so a value is never used as an object key.
  var known = !!rows && !partial;
  var statusData = BROWSE_STATUSES.map((st) => ({ value: st[0], label: st[1] + (known
    ? " (" + (st[0] === "all" ? rows.length : rows.filter((r) => r.status === st[0]).length) + ")" : "") }));
  var pillSource = !m && health ? health : null;
  var pillCur = pillSource ? (pillSource.kind === "health" ? fs.health || "" : (fs.fields || {})[pillSource.field] || "") : "";
  var pillBase = pillSource && known ? applyFilters(rows, Object.assign({}, pillSource.kind === "health" ? Object.assign({}, fs, { health: "" })
    : removeChip(fs, "f." + pillSource.field), { scope: scope, healthRule: pillSource.kind === "health" ? pillSource.rule : null })) : null;
  var pillData = pillSource ? [{ value: "", label: "All" }].concat((pillSource.kind === "health" ? HEALTH_TONES : pillSource.choices).map((v) => {
    var n = pillBase ? pillBase.filter((r) => (pillSource.kind === "health" ? healthOf(pillSource.rule, r) === v : browseText(rowValue(r, pillSource.field)) === String(v))).length : null;
    return { value: String(v), label: (pillSource.kind === "health" ? HEALTH_LABELS[v] : String(v)) + (n === null ? "" : " (" + n + ")") };
  })) : null;
  function pickPill(v) {
    if (pillSource.kind === "health") { writeHash(Object.assign({}, fs, { health: v })); return; }
    var fields = Object.assign({}, fs.fields);
    if (v) fields[pillSource.field] = v; else delete fields[pillSource.field];
    writeHash(Object.assign({}, fs, { fields: fields }));
  }
  var latest = (rows || []).reduce((acc, r) => (r.lastSeen && (!acc || r.lastSeen > acc) ? r.lastSeen : acc), null);
  var starredCount = (rows || []).filter((r) => r.star).length;
  function overlayBadge(r) {
    if (r.overlay === "drop-pending") return <Badge size="sm" color="yellow" variant="light">{"Drop pending" + (r.dropReason ? ": " + r.dropReason : "")}</Badge>;
    if (r.overlay === "kept-pending") return <Badge size="sm" color="yellow" variant="light">Kept (pending next run)</Badge>;
    if (r.overlay === "dropped") return <Badge size="sm" color="red" variant="light">Dropped</Badge>;
    return null;
  }

  var chips = filterChips(fs, t, sourceLabel);
  var fixed = scopeChips(scope, sourceLabel);
  var sources = (def.producers || []).filter((p) => (p.types || []).indexOf(type) !== -1)
    .map((p) => ({ value: p.id, label: p.label || p.id }));
  var peekDoc = peekRow ? (shownDocs || []).find((d) => d.id === peekRow.id) : null;
  var peekState = peekDoc ? keepState(peekDoc.data || {}, decided[peekDoc.id]) : "active";
  var peekComments = peekRow ? commentView((people.comments || []).filter((c) => (c.data || {}).entity === peekRow.id), model.viewer, Date.now()) : [];
  var peekFields = rows && peekRow
    ? allCols.filter((c) => !c.meta && !c.extra).map((c) => ({ key: c.key, label: c.label, text: cellText(c.key, rowValue(peekRow, c.key)) }))
    : [];
  var view = exportOpen ? exportScope(filtered, exportOpen === "selected" ? selIds : null) : null;

  // One results table; a grouped list (fs.group) draws one per group on this page, with the pager below them all.
  function table(recs, paged) {
    return (
      <DataTable
        withTableBorder
        highlightOnHover
        horizontalSpacing={6}
        idAccessor="id"
        columns={columns}
        records={recs}
        {...(paged ? { totalRecords: filtered.length, recordsPerPage: PAGE_SIZE, page: shownPage, onPageChange: setPage } : {})}
        sortStatus={{ columnAccessor: fs.sort.field, direction: fs.sort.dir }}
        onSortStatusChange={(s) => {
          var dir = s.columnAccessor !== fs.sort.field ? "asc" : s.direction;
          writeHash(Object.assign({}, fs, { sort: { field: s.columnAccessor, dir: dir } }));
        }}
        selectedRecords={selected}
        onSelectedRecordsChange={(list) => { setAllMatching(false); setSelIds(new Set(list.map((r) => r.id))); }}
        allRecordsSelectionCheckboxProps={{ "aria-label": "Select all shown" }}
        getRecordSelectionCheckboxProps={(r) => ({ "aria-label": "Select " + (names[r.id] || r.id) })}
        onRowClick={({ record }) => replaceParams({ peek: record.id })}
        noRecordsText={partial && !first.done ? "Loading all " + plural + "…"
          : chips.length ? "No " + plural + " match these filters." : "No " + plural + " yet."}
        minHeight={filtered.length ? undefined : 160}
      />
    );
  }
  var groups = null;
  if (fs.group && records.length) {
    // A Map, not an object: a group value is record data, and "__proto__" or "constructor" must stay a plain key.
    var byGroup = new Map();
    records.forEach((r) => {
      var g = browseText(rowValue(r, fs.group)) || "(none)";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(r);
    });
    groups = Array.from(byGroup.keys()).sort().map((g, i) => ({ name: g, id: i, rows: byGroup.get(g) }));
  }

  return (
    <Stack gap="sm" ref={boxRef}>
      <Title id="page-title" order={1}>{m ? m.label || m.id : plural}</Title>
      <Group gap="sm" wrap="wrap">
        <Badge variant="light">{t.label || type}</Badge>
        {latest ? <Text size="sm" c="dimmed">{"Updated " + human(latest, Date.now())}</Text> : null}
        {starredCount ? <Text size="sm" c="dimmed">{starredCount + " starred"}</Text> : null}
      </Group>
      {viewDocData ? <Text size="sm" c="dimmed">{"View: " + (viewDocData.name || viewId)}</Text> : null}
      {viewReady && viewId && viewState.note ? <Alert color="yellow">{viewState.note}</Alert> : null}
      <Group gap="xs" wrap="wrap">
        <TextInput ref={searchRef} aria-label={"Search " + plural} placeholder={"Search " + plural} leftSection={<IconSearch size={16} />}
          disabled={partial} value={search} onChange={(e) => {
            var v = e.currentTarget.value;
            setSearch(v);
            writeHash(Object.assign({}, fs, { q: v }));
          }} />
        <Button variant="default" leftSection={<IconFilter size={16} />} disabled={partial} onClick={openFilters}>Filters</Button>
        {!m ? (
          <Menu position="bottom-start" onOpen={loadViews}>
            <Menu.Target>
              <Button variant="default" leftSection={<IconLayoutList size={16} />}>Views</Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item component="a" href={"#/browse/" + encodeURIComponent(type)}>{"All " + plural}</Menu.Item>
              <Menu.Item component="a" href={"#/browse/" + encodeURIComponent(type) + "?status=dropped"}>Dropped</Menu.Item>
              {viewList ? viewList.map((v) => (
                <Menu.Item key={v.id} component="a" href={"#/browse/" + encodeURIComponent(type) + "?view=" + encodeURIComponent(v.id)}
                  aria-current={v.id === viewId ? "page" : undefined}
                  rightSection={v.builtIn ? <Badge size="xs" variant="light" color="gray">Built in</Badge> : null}>
                  {String(v.data.name || v.id)}
                </Menu.Item>
              )) : null}
              <Menu.Divider />
              <Menu.Item component="a" href="#/settings/views">All views</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        ) : null}
        <Menu closeOnItemClick={false} position="bottom-start">
          <Menu.Target>
            <Button variant="default" leftSection={<IconColumns3 size={16} />}>Columns</Button>
          </Menu.Target>
          <Menu.Dropdown>
            {allCols.map((c) => (
              <Menu.Item key={c.key} onClick={() => toggleCol(c.key)}
                leftSection={shownKeys.indexOf(c.key) !== -1 ? <IconCheck size={14} /> : <span aria-hidden="true" />}>
                {c.label}
              </Menu.Item>
            ))}
            <Menu.Divider />
            <Menu.Item onClick={resetColumns}>Reset columns</Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <Button variant="default" leftSection={<IconDownload size={16} />} disabled={partial} onClick={() => setExportOpen("view")}>Export</Button>
        {(may || noAccess) && !m ? (
          <Gated reason={noAccess} inline>
          <Popover opened={saveOpen} onDismiss={() => setSaveOpen(false)} position="bottom-start" withArrow trapFocus hideDetached={false}>
            <Popover.Target>
              <Button variant="default" leftSection={<IconDeviceFloppy size={16} />} onClick={() => openSave()}>Save view</Button>
            </Popover.Target>
            <Popover.Dropdown role="dialog" aria-label="Save view">
              <Stack gap="xs">
                <TextInput ref={nameRef} label="View name" value={viewName} error={saveError || null}
                  onChange={(e) => { setViewName(e.currentTarget.value); setSaveError(""); }} />
                <Group gap="xs">
                  {editable ? <Button size="xs" loading={saving} onClick={() => saveView(viewId, viewDocData)}>Update view</Button> : null}
                  <Button size="xs" variant={editable ? "default" : "filled"} loading={saving} onClick={() => saveView(freshId(), null)}>
                    {onView ? "Save as new" : "Save view"}
                  </Button>
                </Group>
              </Stack>
            </Popover.Dropdown>
          </Popover>
          </Gated>
        ) : null}
        {modified ? <Badge color="yellow" variant="light">Modified</Badge> : null}
      </Group>
      <Group gap="xs" wrap="wrap">
        <SegmentedControl size="xs" aria-label="Status" value={fs.status} data={statusData}
          onChange={(v) => writeHash(Object.assign({}, fs, { status: v }))} />
        {pillData ? (
          <SegmentedControl size="xs" value={pillCur} data={pillData} onChange={pickPill}
            aria-label={pillSource.kind === "health" ? "Health" : String((t.fields[pillSource.field] || {}).label || pillSource.field)} />
        ) : null}
      </Group>
      {fixed.length || chips.length ? (
        <Group gap="xs" wrap="wrap">
          {fixed.map((c) => <Badge key={c.label} variant="light" color="gray">{c.label}</Badge>)}
          {chips.map((c) => (
            <Badge key={c.key} variant="light" rightSection={
              <ActionIcon size="xs" variant="transparent" aria-label={"Remove filter " + c.label}
                onClick={() => writeHash(removeChip(fs, c.key))}><IconX size={12} /></ActionIcon>
            }>{c.label}</Badge>
          ))}
        </Group>
      ) : null}
      {selected.length ? (
        <BulkBar rows={selected} names={names} us={us} decided={decided} ctx={ctx} plural={plural}
          matching={partial ? null : filtered.length} allMatching={allMatching}
          onSelectAll={() => { setSelIds(new Set(filtered.map((r) => r.id))); setAllMatching(true); }}
          onExport={() => setExportOpen("selected")} onClear={() => { setAllMatching(false); setSelIds(new Set()); }} />
      ) : null}
      {!rows ? <StateView kind="loading" label={plural} onRetry={() => setAttempt((n) => n + 1)} /> : (
        <>
          {groups ? groups.map((g) => (
            <Stack key={g.name} gap="xs" component="section" aria-labelledby={"group-" + g.id}>
              <Title order={2} size="h4" id={"group-" + g.id}>{g.name + " (" + g.rows.length + ")"}</Title>
              {table(g.rows, false)}
            </Stack>
          )) : table(records, true)}
          {groups && pageCount > 1 ? <Pagination value={shownPage} onChange={setPage} total={pageCount} size="sm" /> : null}
          {docs && docs.length >= FULL_STEP * FULL_READ_MAX ? (
            <Alert color="yellow">{"Read the first " + docs.length + " " + plural + ", the most this list holds. Search, filters and counts cover those only."}</Alert>
          ) : null}
          {partial && fullError ? (
            <Alert color="red" title={"Could not read all " + plural}>
              <Stack gap="xs" align="flex-start">
                <Text size="sm">{String((fullError && fullError.message) || fullError) + " Search, filters and counts need every record."}</Text>
                <Button size="xs" variant="default" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
              </Stack>
            </Alert>
          ) : null}
          <Text size="sm" c="dimmed" aria-live="polite">{partial
            ? countLine({ full: false, shown: records.length, done: false }, plural) + (fullError ? "" : ". Loading all " + plural + "…")
            : countLine({ full: true, shown: records.length, matching: filtered.length, total: rows.length }, plural)}</Text>
          {!partial && health && health.kind === "health" ? <Text size="sm" c="dimmed">{notGreenLine(notGreenCount(health.rule, rows))}</Text> : null}
          {partial ? null : <Group gap="xs" wrap="wrap">
            {calcs.map((c, i) => {
              var name = CALC_FNS[c.fn] + " of " + ((colByKey[c.field] || {}).label || c.field);
              return (
                <Badge key={c.field + ":" + c.fn} variant="outline" color="gray" rightSection={
                  <ActionIcon size="xs" variant="transparent" aria-label={"Remove calculation " + name}
                    onClick={() => setCalcs(calcs.filter((_, j) => j !== i))}><IconX size={12} /></ActionIcon>
                }>{name + ": " + calcValue(filtered, c)}</Badge>
              );
            })}
            <Popover opened={calcOpen} onDismiss={() => setCalcOpen(false)} position="top-start" withArrow trapFocus hideDetached={false}>
              <Popover.Target>
                <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setCalcOpen((o) => !o)}>
                  Add calculation
                </Button>
              </Popover.Target>
              <Popover.Dropdown>
                <Stack gap="xs">
                  <NativeSelect label="Column" value={calcField || (shownCols[0] && shownCols[0].key) || ""}
                    onChange={(e) => setCalcField(e.currentTarget.value)}
                    data={shownCols.map((c) => ({ value: c.key, label: c.label }))} />
                  <NativeSelect label="Calculation" value={calcFn} onChange={(e) => setCalcFn(e.currentTarget.value)}
                    data={Object.keys(CALC_FNS).map((k) => ({ value: k, label: CALC_FNS[k] }))} />
                  <Button size="xs" onClick={addCalc}>Add</Button>
                </Stack>
              </Popover.Dropdown>
            </Popover>
          </Group>}
        </>
      )}
      <Filters opened={filtersOpen} onOpen={openFilters} onClose={() => setFiltersOpen(false)} fs={fs} t={t}
        rows={rows} cols={allCols} sources={sources} health={health && health.kind === "health" ? health : null}
        onChange={writeHash} onClear={() => writeHash(Object.assign(readFilterState({}), { sort: fs.sort, group: fs.group, cols: fs.cols }))} />
      <Peek query={recQuery} row={peekRow} title={peekRow ? names[peekRow.id] || peekRow.id : ""} fields={peekFields}
        ids={filtered.map((r) => r.id)} ctx={ctx} state={peekState} decided={!!(peekRow && decided[peekRow.id])}
        comments={peekComments}
        onMove={(id) => replaceParams({ peek: id })} onClose={() => replaceParams({ peek: null })} />
      <ExportModal opened={!!exportOpen} onClose={() => setExportOpen(null)} rows={view ? exportRows(view.rows) : []}
        cols={shownCols.map((c) => ({ key: c.key, label: c.label }))} label={view ? view.label : ""}
        workspace={(model.workspace && model.workspace.name) || ""} plural={plural} />
    </Stack>
  );
}
