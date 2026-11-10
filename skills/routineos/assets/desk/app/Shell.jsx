// app/Shell.jsx: the Desk frame. It boots the store, draws the header, the navbar (core/palette.js navModel), the
// bell, the palette and the keys, and puts the page for the route in the main area. Pages that are not built yet
// show their title only.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon, Alert, AppShell, Badge, Box, Burger, Group, Kbd, Menu, Modal, NavLink, ScrollArea, Stack, Table, Text, Title,
  useMantineColorScheme,
} from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import { spotlight } from "@mantine/spotlight";
import { IconCheck, IconChevronDown, IconChevronRight, IconDotsVertical, IconKeyboard, IconLock, IconRoute, IconSearch, IconUserCircle, IconWifiOff } from "@tabler/icons-react";
import { forgetLockPass, lockPassed } from "../core/lock.js";
import { NAV_GROUP_KEY, readPref, savePref } from "../core/prefs.js";
import { findPage, navPages } from "../core/ext.js";
import { SIGN_OUT_NOTE, moduleFor, navModel, navTypes_, shortcutRows, signedInLine, specPageFor } from "../core/palette.js";
import { personName_ } from "../core/shared.js";
import Bell, { useShellFeed } from "./Bell.jsx";
import { boot } from "./boot.js";
import { icon } from "./icons.js";
import Keyboard from "./Keyboard.jsx";
import Palette from "./Palette.jsx";
import { LockScreen } from "./settings/lock.jsx";
import { OFFLINE_TEXT, StateView } from "./States.jsx";
import { ModelProvider, PageCommandsProvider, useModel, useStore } from "./StoreContext.jsx";
import { usePrefs } from "./usePrefs.js";
import { useRestoreRoute, useRoute } from "./useRoute.js";
import { TourProvider, useTour } from "./Tour.jsx";

var PAGE_TITLES = { today: "Today", approvals: "Approvals", history: "History", settings: "Settings", workers: "Workers",
  runs: "Runs", run: "Run", entity: "Record" };

// Pages register here as they are built; any other page shows its title.
export var PAGES = {};

export function pageTitle(r, definition) {
  if (r.page === "browse") {
    var t = definition && definition.types && Object.prototype.hasOwnProperty.call(definition.types, r.params.type)
      ? definition.types[r.params.type] : null;
    return t ? String(t.plural || t.label || r.params.type) : "Not found";
  }
  if (r.page === "module") {
    var m = moduleFor(definition, r.params.id);
    return m ? String(m.label || m.id) : "Not found";
  }
  if (r.page === "spec") {
    var sp = specPageFor(definition, r.params.id);
    return sp ? String(sp.title) : "Not found";
  }
  if (r.page === "ext") {
    var x = findPage(typeof window !== "undefined" ? window.DESK_EXTENSIONS : null, r.params.name);
    return x ? String(x.title || x.id) : "Not found";
  }
  return PAGE_TITLES[r.page] || "Today";
}

function Placeholder({ title }) {
  return <Title id="page-title" order={1}>{title}</Title>;
}

// Offline (spec 5.13): the browser says so or a store call drops; the next good read clears it.
function useOffline(store) {
  const [offline, setOffline] = useState(() => globalThis.navigator && navigator.onLine === false);
  useEffect(() => {
    function down() { setOffline(true); }
    // Back online: one read decides; it clears the alert through onReadOk when it lands.
    function back() { if (store) store.get("meta/workspace").catch(() => {}); }
    var stops = [];
    if (store && store.onNetworkError) stops.push(store.onNetworkError(down));
    if (store && store.onReadOk) stops.push(store.onReadOk(() => { if (navigator.onLine !== false) setOffline(false); }));
    window.addEventListener("offline", down);
    window.addEventListener("online", back);
    return () => {
      stops.forEach((s) => s());
      window.removeEventListener("offline", down);
      window.removeEventListener("online", back);
    };
  }, [store]);
  return offline;
}

// A parent with saved views: the label goes to its list (and closes the phone drawer); the chevron beside it shows or
// hides the views and leaves the drawer open. The open state is kept per group under NAV_GROUP_KEY.
function NavParent({ n, hash, onNavigate, children }) {
  var key = NAV_GROUP_KEY + n.id;
  const [open, setOpen] = useState(() => readPref(key, ["open", "closed"], "open") === "open");
  function toggle() {
    savePref(key, open ? "closed" : "open");
    setOpen(!open);
  }
  var Chevron = open ? IconChevronDown : IconChevronRight;
  return (
    <>
      <Group gap={0} wrap="nowrap">
        <Box flex={1} miw={0}>{children}</Box>
        <ActionIcon variant="subtle" color="gray" aria-label={(open ? "Hide " : "Show ") + n.label + " views"}
          aria-expanded={open} onClick={toggle}>
          <Chevron size={16} stroke={1.5} />
        </ActionIcon>
      </Group>
      {open ? (
        <Stack gap={0} pl={28}>
          {n.children.map((c) => {
            var Kid = icon(c.icon);
            return <NavLink key={c.id} href={c.href} label={c.label} active={hash === c.href} onClick={onNavigate}
              leftSection={<Kid size={14} stroke={1.5} />} />;
          })}
        </Stack>
      ) : null}
    </>
  );
}

function NavItems({ items, hash, onNavigate }) {
  var path = hash.split("?")[0];
  return items.map((n) => {
    var Icon = icon(n.icon);
    var link = (
      <NavLink key={n.id} href={n.href} label={n.label} active={path === n.href} onClick={onNavigate}
        leftSection={<Icon size={18} stroke={1.5} />}
        rightSection={typeof n.count === "number" && n.count > 0 ? <Badge size="sm" variant="light" circle>{n.count}</Badge> : undefined} />
    );
    if (!(n.children && n.children.length)) return link;
    return <NavParent key={n.id} n={n} hash={hash} onNavigate={onNavigate}>{link}</NavParent>;
  });
}

// Below 24 root ems (384px at 16px text: a 320 phone, or 200% text on a 390 phone) the header merges search into the
// settings menu so every control stays on screen.
function useNarrowHeader() {
  const { width } = useViewportSize();
  var root = 16;
  try { root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16; } catch (e) { root = 16; }
  return width > 0 && width < 24 * root;
}

function UserMenu({ onHelp, onLock, narrow }) {
  const prefs = usePrefs();
  const tour = useTour();
  const { setColorScheme } = useMantineColorScheme();
  const model = useModel();
  const store = useStore();
  const viewer = model && model.viewer;
  const [signedIn, setSignedIn] = useState(null);
  useEffect(() => {
    var live = true;
    setSignedIn(null);
    if (!viewer || !store || typeof store.profiles !== "function") return undefined;
    store.profiles([viewer]).then((p) => { if (live) setSignedIn(signedInLine(personName_(p || {}, viewer, null))); }, () => {});
    return () => { live = false; };
  }, [store, viewer]);
  function theme(t) {
    prefs.set("theme", t);
    setColorScheme(t === "system" ? "auto" : t);
  }
  var tick = (on) => (on ? <IconCheck size={14} /> : null);
  return (
    <Menu position="bottom-end" width={220}>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size="lg" aria-label={narrow ? "Search and settings" : "Your settings"}>
          {narrow ? <IconDotsVertical size={20} stroke={1.5} /> : <IconUserCircle size={20} stroke={1.5} />}
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {signedIn ? <Menu.Label>{signedIn}</Menu.Label> : null}
        {signedIn ? <Menu.Label>{SIGN_OUT_NOTE}</Menu.Label> : null}
        {signedIn ? <Menu.Divider /> : null}
        {narrow ? <Menu.Item leftSection={<IconSearch size={14} />} onClick={() => spotlight.open()}>Search or jump to</Menu.Item> : null}
        {narrow ? <Menu.Divider /> : null}
        <Menu.Label>Theme</Menu.Label>
        {[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([v, label]) => (
          <Menu.Item key={v} rightSection={tick(prefs.theme === v)} onClick={() => theme(v)}>{label}</Menu.Item>
        ))}
        <Menu.Label>Density</Menu.Label>
        {[["comfortable", "Comfortable"], ["compact", "Compact"]].map(([v, label]) => (
          <Menu.Item key={v} rightSection={tick(prefs.density === v)} onClick={() => prefs.set("density", v)}>{label}</Menu.Item>
        ))}
        <Menu.Label>Motion</Menu.Label>
        {[["system", "Follow the system"], ["reduce", "Reduce"]].map(([v, label]) => (
          <Menu.Item key={v} rightSection={tick(prefs.motion === v)} onClick={() => prefs.set("motion", v)}>{label}</Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item leftSection={<IconKeyboard size={14} />} onClick={onHelp}>Keyboard shortcuts</Menu.Item>
        {tour.available ? <Menu.Item leftSection={<IconRoute size={14} />} onClick={tour.start}>Take the tour</Menu.Item> : null}
        {onLock ? <Menu.Item leftSection={<IconLock size={14} />} onClick={onLock}>Lock now</Menu.Item> : null}
      </Menu.Dropdown>
    </Menu>
  );
}

function Shortcuts({ opened, onClose, types }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Keyboard shortcuts">
      <Table>
        <Table.Tbody>
          {shortcutRows(types).map(([keys, what]) => (
            <Table.Tr key={keys + what}>
              <Table.Td><Kbd>{keys}</Kbd></Table.Td>
              <Table.Td>{what}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Modal>
  );
}

export default function Shell({ config }) {
  const store = useStore();
  const prefs = usePrefs();
  const r = useRoute();
  const [model, setModel] = useState(null);
  const [mobileOpened, setMobileOpened] = useState(false);
  const [helpOpened, setHelpOpened] = useState(false);
  const [paletteOpened, setPaletteOpened] = useState(false);
  const [bellOpened, setBellOpened] = useState(false);
  const [, setPassTick] = useState(0);
  const [pageCommands, setPageCommands] = useState([]);
  const offline = useOffline(store);
  const narrow = useNarrowHeader();
  const patch = useCallback((p) => setModel((m) => (m ? Object.assign({}, m, p) : m)), []);

  const load = useCallback(() => {
    let live = true;
    setModel(null);
    boot(store, config).then((m) => { if (live) setModel(m); });
    return () => { live = false; };
  }, [store, config]);
  useEffect(load, [load]);

  const feed = useShellFeed(model);
  const routeCtx = useMemo(() => (model && !model.failed && model.viewer
    ? { store: store, viewer: model.viewer, canWriteShared: model.canWriteShared } : null), [store, model]);
  useRestoreRoute(routeCtx, r.hash);
  const definition = model && !model.failed ? model.definition : null;
  const nav = useMemo(() => {
    var built = navModel(definition, feed.views, feed.pins, model && model.join, feed.hidden, undefined,
      navPages(typeof window !== "undefined" ? window.DESK_EXTENSIONS : null));
    built.groups[0].items.forEach((n) => { if (n.id === "approvals") n.count = feed.waiting.count; });
    return built;
  }, [definition, feed, model]);
  const types = useMemo(() => navTypes_(definition), [definition]);

  var desktopOpened = prefs.sidebar !== "slim";
  function toggleSidebar() {
    prefs.set("sidebar", desktopOpened ? "slim" : "full");
    setMobileOpened(!desktopOpened);
  }
  var closeMobile = () => setMobileOpened(false);
  var name = (model && model.workspace && model.workspace.name) || (config && config.workspace) || "Desk";

  var locked = !!(model && !model.failed && model.lock && !lockPassed(model.lock.salt));
  if (locked) {
    return (
      <ModelProvider model={model} patch={patch}>
        <LockScreen lock={model.lock} name={name} onPass={() => setPassTick((n) => n + 1)} />
      </ModelProvider>
    );
  }
  var ready = !!definition;
  var lockNow = model && model.lock ? () => { forgetLockPass(); setPassTick((n) => n + 1); } : null;

  let body;
  if (!model) body = <StateView kind="loading" label="the workspace" onRetry={load} />;
  else if (model.failed === "no-db") body = <StateView kind="no-db" />;
  else if (model.failed) body = <StateView kind="error" collection="the workspace" whole message={model.failError} onRetry={load} />;
  else if (!model.definition) body = <StateView kind="not-set-up" name={model.workspace && model.workspace.name} />;
  else {
    var Page = PAGES[r.page];
    body = Page ? <Page route={r} /> : <Placeholder title={pageTitle(r, model.definition)} />;
  }

  return (
    <ModelProvider model={model} patch={patch}>
      <PageCommandsProvider set={setPageCommands}>
      <TourProvider model={model} ready={ready}>
      <AppShell header={{ height: 56 }} padding="md"
        navbar={{ width: 260, breakpoint: "sm", collapsed: { mobile: !mobileOpened, desktop: !desktopOpened } }}>
        <AppShell.Header>
          <Group h="100%" px={narrow ? "xs" : "md"} gap="xs" justify="space-between" wrap="nowrap">
            <Group gap="xs" wrap="nowrap" miw={0}>
              <Burger opened={mobileOpened} onClick={() => setMobileOpened((o) => !o)} hiddenFrom="sm" size="sm"
                aria-label="Toggle navigation" aria-expanded={mobileOpened} />
              <Burger opened={desktopOpened} onClick={toggleSidebar} visibleFrom="sm" size="sm"
                aria-label="Toggle sidebar" aria-expanded={desktopOpened} />
              <Text fw={700} truncate>{name}</Text>
            </Group>
            <Group gap="xs" wrap="nowrap" flex="none">
              {narrow ? null : (
                <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Search or jump to" onClick={() => spotlight.open()}>
                  <IconSearch size={20} stroke={1.5} />
                </ActionIcon>
              )}
              <Bell feed={feed} opened={bellOpened} onChange={setBellOpened} />
              <UserMenu onHelp={() => setHelpOpened(true)} onLock={lockNow} narrow={narrow} />
            </Group>
          </Group>
        </AppShell.Header>
        <AppShell.Navbar p="xs" aria-label="Desk">
          <AppShell.Section grow component={ScrollArea}>
            {nav.groups.map((g) => (
              <Stack key={g.id} gap={0} mb="sm">
                <Text size="xs" c="dimmed" fw={600} px="sm" py={4}>{g.label}</Text>
                <NavItems items={g.items} hash={r.hash} onNavigate={closeMobile} />
              </Stack>
            ))}
          </AppShell.Section>
          <AppShell.Section>
            <NavItems items={[nav.members, nav.settings]} hash={r.hash} onNavigate={closeMobile} />
          </AppShell.Section>
        </AppShell.Navbar>
        <AppShell.Main>
          <Stack>
            {offline ? <Alert color="yellow" icon={<IconWifiOff />} role="status">{OFFLINE_TEXT}</Alert> : null}
            {definition && store && store.readOnly ? <StateView kind="read-only" /> : null}
            {body}
          </Stack>
        </AppShell.Main>
      </AppShell>
      <Palette nav={nav} definition={definition} go={r.go} extra={pageCommands} onOpenChange={setPaletteOpened} />
      <Shortcuts opened={helpOpened} onClose={() => setHelpOpened(false)} types={types} />
      <Keyboard enabled={!helpOpened && !paletteOpened} definition={definition} page={r.page} go={r.go} onSidebar={toggleSidebar}
        onHelp={() => setHelpOpened(true)} onBell={() => setBellOpened((o) => !o)} onPalette={() => spotlight.toggle()} />
      </TourProvider>
      </PageCommandsProvider>
    </ModelProvider>
  );
}
