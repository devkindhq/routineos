// app/pages/SpecPage.jsx: #/p/<id>, a spec page (definition.desk.pages). The blocks are drawn from the entities the
// routine wrote (core/pages/spec-read.js, spec-query.js); nothing here writes. A page not in the definition is a not
// found card. Range and filter live in the address; auto refresh is this viewer's choice (core/prefs.js).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Anchor, Card, Grid, Stack, Text, Title } from "@mantine/core";
import { human } from "../../core/dates.js";
import { browseText, rowValue } from "../../core/pages/browse.js";
import { AUTO_GRACE_MS, msUntilRefresh } from "../../core/pages/autorefresh.js";
import { readSpecRows } from "../../core/pages/spec-read.js";
import { parseRange } from "../../core/pages/spec-query.js";
import { specPageFor } from "../../core/palette.js";
import { readPref, savePref } from "../../core/prefs.js";
import { useModel, useStore } from "../StoreContext.jsx";
import { replaceParams } from "../useRoute.js";
import Boundary from "./spec/Boundary.jsx";
import { BLOCKS } from "./spec/blocks.jsx";
import Controls from "./spec/Controls.jsx";
import { DRAW_FAILED, LOADING, PARTIAL } from "./spec/states.js";

var AUTO_KEY = "routineos-desk-autorefresh:";

function typesOf(page) {
  var seen = new Set();
  (page.blocks || []).forEach((b) => { if (b.query && b.query.type) seen.add(b.query.type); });
  return Array.from(seen);
}

function NotFound() {
  return (
    <Stack gap="sm">
      <Title id="page-title" order={1}>Not found</Title>
      <Card withBorder padding="md"><Text>This page is not in this routine.</Text></Card>
      <Anchor href="#/today">Back to Today</Anchor>
    </Stack>
  );
}

export default function SpecPage({ route }) {
  var model = useModel();
  var definition = model && model.definition;
  var id = route.params.id;
  // One page object per definition and id: a new object on every render would restart the read on each filter click.
  var page = useMemo(() => specPageFor(definition, id), [definition, id]);
  if (!page) return <NotFound />;
  var failed = (
    <Stack gap="sm">
      <Title id="page-title" order={1}>{page.title}</Title>
      <Alert color="red" title="This page could not be drawn">The page definition or its data is not something the Desk can draw. The rest of the Desk still works.</Alert>
    </Stack>
  );
  return (
    <Boundary resetKey={page.id} fallback={failed}>
      <Loaded key={page.id} page={page} definition={definition} query={route.params.query || {}} />
    </Boundary>
  );
}

function Loaded({ page, definition, query }) {
  var store = useStore();
  var [data, setData] = useState(null); // {byType, capped, readAt}
  var [failed, setFailed] = useState(false);
  var [refreshing, setRefreshing] = useState(false);
  var [auto, setAuto] = useState(() => readPref(AUTO_KEY + page.id, ["on", "off"], "on") === "on");
  var types = useMemo(() => typesOf(page), [page]);
  var live = useRef(true);
  var seq = useRef(0); // a read that lands after a newer one started is dropped, so an old result cannot overwrite a new one
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  var read = useCallback(() => {
    var mine = ++seq.current;
    return Promise.all(types.map((t) => readSpecRows(store, { type: t }))).then((out) => {
      if (!live.current || mine !== seq.current) return;
      var byType = new Map();
      types.forEach((t, i) => { byType.set(t, out[i].rows); });
      setFailed(false);
      setData({ byType: byType, capped: out.some((o) => o.capped), readAt: out.reduce((m, o) => Math.max(m, o.readAt), 0) });
    }, () => { if (live.current && mine === seq.current) setFailed(true); });
  }, [store, types]);

  useEffect(() => { read(); }, [read]);

  var refresh = useCallback(() => {
    setRefreshing(true);
    var reloaded = typeof store.reload === "function" ? Promise.resolve(store.reload()) : Promise.resolve();
    return reloaded.then(read, read).then(() => { if (live.current) setRefreshing(false); });
  }, [store, read]);

  // One timer for the next run plus a short grace; it is set again after every read, so it follows the schedule.
  var readAt = data ? data.readAt : null;
  var hasRefresh = (page.controls || []).indexOf("refresh") !== -1;
  var canAuto = msUntilRefresh(definition, Date.now(), AUTO_GRACE_MS) !== null;
  useEffect(() => {
    // After a failed read the timer is set again too, so the next run's refresh still happens.
    if (!hasRefresh || !auto || (readAt === null && !failed)) return undefined;
    var wait = msUntilRefresh(definition, Date.now(), AUTO_GRACE_MS);
    if (wait === null) return undefined;
    var id = setTimeout(refresh, wait);
    return () => clearTimeout(id);
  }, [hasRefresh, auto, readAt, failed, definition, refresh]);

  function setAutoPref(on) {
    savePref(AUTO_KEY + page.id, on ? "on" : "off");
    setAuto(on);
  }

  var range = parseRange(query.range);
  var [draft, setDraft] = useState(null);
  var filter = query.filter || "";
  var field = page.filter && page.filter.field;
  var values = useMemo(() => {
    if (!field || !data) return [];
    var seen = new Set();
    data.byType.forEach((rows) => rows.forEach((r) => {
      var v = browseText(rowValue(r, field));
      if (v) seen.add(v);
    }));
    return Array.from(seen).sort();
  }, [field, data]);
  // A value in the address that is not in the data is shown as All and applies no filter.
  if (data && filter && values.indexOf(filter) === -1) filter = "";
  var ctx = { now: Date.now(), range: range, filter: field && filter ? { field: field, value: filter } : null };

  // The two dates are typed one at a time, so each is kept here and the address gets the pair once both are set.
  function onRange(from, to) {
    setDraft({ from: from, to: to });
    replaceParams({ range: from && to ? from + ".." + to : "" });
  }

  return (
    <Stack gap="md">
      <Title id="page-title" order={1}>{page.title}</Title>
      <Controls page={page} range={range ? { from: range.from, to: range.to } : draft} filter={filter} values={values} onRange={onRange}
        onFilter={(v) => replaceParams({ filter: v })} onRefresh={refresh} refreshing={refreshing}
        auto={auto} onAuto={setAutoPref} canAuto={canAuto} updated={readAt ? human(new Date(readAt).toISOString(), Date.now()) : ""} />
      {failed ? <Alert color="red" title="This page could not read its data">Try Refresh. If it keeps failing, the store may be offline.</Alert> : null}
      {data && data.capped ? <Alert color="yellow">{PARTIAL}</Alert> : null}
      {!data && !failed ? <Text c="dimmed" role="status">{LOADING}</Text> : null}
      {data ? <Grid>
        {(page.blocks || []).map((b) => {
          var Block = BLOCKS[b.kind];
          if (!Block) return null;
          var span = b.span || {};
          return (
            <Grid.Col key={b.id} span={{ base: span.base || 12, md: span.md || span.base || 12 }}>
              <Boundary resetKey={readAt} fallback={<Alert color="red" variant="light">{DRAW_FAILED}</Alert>}>
                <Block block={b} rows={b.query ? data.byType.get(b.query.type) : null} ctx={ctx} />
              </Boundary>
            </Grid.Col>
          );
        })}
      </Grid> : null}
    </Stack>
  );
}
