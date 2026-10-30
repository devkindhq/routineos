/* src/shell.js: sidebar (full or slim at 900px and up, a drawer under it), top bar (search, notifications,
   density, theme), bottom nav under 900px, page outlet, notifications panel, command palette and shortcuts. */

const SHELL_NAME = "Desk";

var THEMES = ["system", "light", "dark"];
var THEME_ICONS = { system: "monitor", light: "sun", dark: "moon" };
var THEME_KEY = "routineos-desk-theme";
var SIDEBAR_KEY = "routineos-desk-sidebar";
var DENSITY_KEY = "routineos-desk-density";
var DENSITIES = ["comfortable", "compact"];
var G_WAIT_MS = 1500;
var DESK_MQ = "(min-width: 900px)";

var PAGE_TITLES = { today: "Today", inbox: "Inbox", approvals: "Approvals", suggestions: "Suggestions", views: "Views",
  history: "History", settings: "Settings", workers: "Workers" };
// The sidebar entry that is current for each page; a type page uses its own type entry.
var NAV_PAGE = { suggestions: "inbox", views: "settings", run: "history" };

// Per-viewer conveniences only; the page works the same when storage is blocked.
function readPref(key, allowed, fallback) {
  var v = null;
  try { v = localStorage.getItem(key); } catch (e) { v = null; }
  return allowed.indexOf(v) === -1 ? fallback : v;
}

function savePref(key, v) {
  try { localStorage.setItem(key, v); } catch (e) { /* blocked: the choice lasts this visit */ }
}

function readTheme() { return readPref(THEME_KEY, THEMES, "system"); }
function saveTheme(t) { savePref(THEME_KEY, t); }

function applyTheme(t) {
  var root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

function themeLabel(t) {
  return "Theme: " + t.charAt(0).toUpperCase() + t.slice(1);
}

function types(definition) {
  var t = (definition && definition.types) || {};
  return Object.keys(t).sort().map(function (id) {
    return { id: id, label: t[id].label || id, plural: t[id].plural || t[id].label || id };
  });
}

function pageTitle(r, definition) {
  var t = (definition && definition.types) || {};
  var type = r.params.type && t[r.params.type];
  if (r.page === "browse") return type ? type.plural || type.label : "Browse";
  if (r.page === "entity") return type ? type.label : "Record";
  if (r.page === "run") return "Run";
  return PAGE_TITLES[r.page] || "Today";
}

function navIdFor(r) {
  if ((r.page === "browse" || r.page === "entity") && r.params.type) return "type:" + r.params.type;
  return NAV_PAGE[r.page] || r.page;
}

var mounted = null;

// ctx: {store, definition, workspace, viewer, pages, failed, loading}. pages maps a page name to
// render(outlet, ctx, params) returning an unsubscribe. A page may set ctx.pageCommands to a function
// returning palette commands [{id, label, run}] for the page; the shell clears it on each route.
function mount(root, ctx) {
  if (mounted) mounted.unmount();
  clear(root);
  append(root, iconSprite());
  var theme = readTheme();
  applyTheme(theme);
  var density = readPref(DENSITY_KEY, DENSITIES, "comfortable");
  var slim = readPref(SIDEBAR_KEY, ["slim", "full"], "full") === "slim";
  var list = types(ctx.definition);
  var savedViews = [], pins = null, feed = [], notifOpen = false, notifTabName = "all";
  var overlays = [];
  var current = route();

  var pageName = el("span", { class: "page-name" });
  // An icon button: monitor, sun or moon for the current choice; the label names it and what a press does.
  var themeBtn = el("button", { type: "button", class: "ghost icon-btn theme-toggle" });
  function drawThemeBtn() {
    var label = themeLabel(theme) + ". Change theme";
    clear(themeBtn);
    append(themeBtn, icon(THEME_ICONS[theme] || "monitor"));
    themeBtn.setAttribute("aria-label", label);
    themeBtn.setAttribute("title", label);
  }
  drawThemeBtn();
  function setTheme(t) {
    theme = THEMES.indexOf(t) === -1 ? "system" : t;
    applyTheme(theme);
    saveTheme(theme);
    drawThemeBtn();
  }
  function nextTheme() { setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]); }
  themeBtn.addEventListener("click", nextTheme);
  // Settings offers the same choice; both controls go through setTheme.
  ctx.themes = THEMES;
  ctx.theme = function () { return theme; };
  ctx.setTheme = setTheme;

  var densityBtn = el("button", { type: "button", class: "ghost icon-btn density-toggle" }, icon("rows-3"));
  function setDensity(d) {
    density = DENSITIES.indexOf(d) === -1 ? "comfortable" : d;
    if (density === "compact") document.documentElement.setAttribute("data-density", "compact");
    else document.documentElement.removeAttribute("data-density");
    savePref(DENSITY_KEY, density);
    var label = "Density: " + (density === "compact" ? "Compact" : "Comfortable") + ". Change density";
    densityBtn.setAttribute("aria-label", label);
    densityBtn.setAttribute("title", label);
    densityBtn.setAttribute("aria-pressed", density === "compact" ? "true" : "false");
  }
  setDensity(density);
  densityBtn.addEventListener("click", function () { setDensity(density === "compact" ? "comfortable" : "compact"); });

  var bellCount = el("span", { class: "bell-count" });
  var bellBtn = el("button", { type: "button", class: "ghost icon-btn bell", "aria-expanded": "false" }, icon("bell"), bellCount);
  function drawBell() {
    var n = unreadCount(feed);
    bellCount.textContent = n ? String(n > 99 ? "99+" : n) : "";
    bellCount.hidden = !n;
    var label = "Notifications" + (n ? ", " + n + " unread" : "");
    bellBtn.setAttribute("aria-label", label);
    bellBtn.setAttribute("title", label);
    bellBtn.setAttribute("aria-expanded", notifOpen ? "true" : "false");
  }
  bellBtn.addEventListener("click", function () { toggleNotif(); });

  var searchInput = el("input", { type: "search", class: "top-search-input", autocomplete: "off" });
  var searchForm = el("form", { class: "top-search", role: "search" }, icon("search"), searchInput);
  function searchType() { return (current.page === "browse" || current.page === "entity") && current.params.type; }
  function drawSearch() {
    var tid = searchType();
    var t = tid && list.filter(function (x) { return x.id === tid; })[0];
    var label = t ? "Search " + t.plural : "Search all records";
    searchInput.setAttribute("aria-label", label);
    searchInput.setAttribute("placeholder", label);
  }
  // On a type page the search filters that list; elsewhere it offers a search of each type in the palette.
  searchForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = searchInput.value.trim();
    var tid = searchType();
    if (tid) {
      location.hash = "#/browse/" + encodeURIComponent(tid) + (q ? "?q=" + encodeURIComponent(q) : "");
      searchInput.value = "";
      return;
    }
    openPalette(q, true);
  });

  var menuBtn = button("Open the menu", function () { setDrawer(!root.querySelector(".app").classList.contains("drawer-open")); }, { icon: "menu", iconOnly: true });
  menuBtn.classList.add("menu-btn");
  var workspaceName = (ctx.workspace && ctx.workspace.name) || "Workspace";
  var top = el("header", { class: "top" },
    menuBtn,
    el("div", { class: "where" }, el("span", { class: "workspace" }, el("span", { class: "ws-name" }, workspaceName), el("span", { class: "ws-shell" }, " / " + SHELL_NAME)), pageName),
    ctx.definition ? searchForm : null,
    el("div", { class: "tools" },
      ctx.store && ctx.store.readOnly ? el("span", { class: "badge demo", title: "Read only" }, "Demo data") : null,
      ctx.definition ? bellBtn : null, densityBtn, themeBtn));

  var navList = el("ul", { class: "nl" });
  var slimBtn = el("button", { type: "button", class: "ghost side-toggle" }, icon("panel-left"), el("span", { class: "lbl" }, "Slim sidebar"),
    el("span", { class: "kbd", "aria-hidden": "true" }, "["));
  slimBtn.addEventListener("click", function () { toggleSidebar(); });
  var rail = el("nav", { class: "rail", "aria-label": "Pages" },
    el("div", { class: "brand" }, el("span", { class: "mark", "aria-hidden": "true" }, workspaceName.charAt(0).toUpperCase()),
      el("span", { class: "ws" }, el("span", { class: "ws-title" }, workspaceName), el("small", null, "RoutineOS " + SHELL_NAME))),
    navList,
    el("div", { class: "sfoot" }, slimBtn));
  var bottom = el("nav", { class: "bottom-nav", "aria-label": "Pages" });
  var outlet = el("main", { class: "outlet", id: "outlet", tabindex: "-1" });
  var notifHost = el("div", { class: "notif-host" });
  var sideBack = el("div", { class: "side-back", hidden: true, onclick: function () { setDrawer(false); } });
  var notifBack = el("div", { class: "notif-back", hidden: true, onclick: function () { toggleNotif(false); } });
  var frame = el("div", { class: "frame" }, outlet, notifHost);
  var app = el("div", { class: "app" + (slim ? " slim" : "") }, rail, el("div", { class: "pane" }, top, frame));
  append(root, [app, bottom, sideBack, notifBack]);

  // The icon is decorative; the label names the link, and in slim mode it stays in the accessible name.
  function navLink(n, cls) {
    var a = el("a", { href: n.href, "data-nav": n.id, class: cls || null, title: slim ? n.label : null },
      icon(n.icon), el("span", { class: "lbl" }, n.label),
      n.pinned ? el("span", { class: "visually-hidden" }, " (pinned)") : null);
    return a;
  }
  function drawNav() {
    var nav = navModel(ctx.definition, savedViews, pins, ctx.join);
    clear(navList);
    append(navList, nav.map(function (n) {
      return el("li", null, navLink(n), n.children.length ? el("ul", { class: "sub" }, n.children.map(function (c) {
        return el("li", null, navLink(c, "view-link"));
      })) : null);
    }));
    clear(bottom);
    append(bottom, bottomModel(nav).map(function (n) {
      return el("a", { href: n.href, "data-nav": n.id }, el("span", { class: "bn-icon" }, icon(n.icon)), el("span", { class: "bn-lbl" }, n.label));
    }));
    markCurrent();
    return nav;
  }
  function markCurrent() {
    var id = navIdFor(current);
    var view = current.params.query && current.params.query.view;
    [navList, bottom].forEach(function (box) {
      Array.prototype.forEach.call(box.querySelectorAll("a[data-nav]"), function (a) {
        var nid = a.getAttribute("data-nav");
        var hit = view ? nid === "view:" + view || (box === bottom && nid === id) : nid === id;
        if (hit) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      });
    });
  }

  function toggleSidebar() {
    if (window.matchMedia && !window.matchMedia(DESK_MQ).matches) { setDrawer(!app.classList.contains("drawer-open")); return; }
    slim = !slim;
    app.classList.toggle("slim", slim);
    savePref(SIDEBAR_KEY, slim ? "slim" : "full");
    drawSlimBtn();
    Array.prototype.forEach.call(navList.querySelectorAll("a[data-nav]"), function (a) {
      if (slim) a.setAttribute("title", a.querySelector(".lbl").textContent); else a.removeAttribute("title");
    });
  }
  // In slim mode the label is visually hidden, so the title carries it as a tooltip.
  function drawSlimBtn() {
    var label = slim ? "Full sidebar" : "Slim sidebar";
    slimBtn.querySelector(".lbl").textContent = label;
    slimBtn.setAttribute("title", label + " ([)");
  }
  drawSlimBtn();

  // Overlays close top first with Esc. Each entry: {name, close}.
  function pushOverlay(name, close) { overlays.push({ name: name, close: close }); }
  function dropOverlay(name) { overlays = overlays.filter(function (o) { return o.name !== name; }); }
  function setDrawer(on) {
    app.classList.toggle("drawer-open", !!on);
    sideBack.hidden = !on;
    menuBtn.setAttribute("aria-expanded", on ? "true" : "false");
    dropOverlay("drawer");
    if (on) pushOverlay("drawer", function () { setDrawer(false); });
  }

  function drawNotif() {
    clear(notifHost);
    if (!notifOpen) return;
    append(notifHost, notifPanel(ctx, feed, {
      tab: notifTabName,
      onTab: function (t) { notifTabName = t; drawNotif(); },
      onClose: function () { toggleNotif(false); },
    }));
  }
  function toggleNotif(on) {
    notifOpen = on === undefined ? !notifOpen : !!on;
    frame.classList.toggle("notif-open", notifOpen);
    notifBack.hidden = !notifOpen;
    dropOverlay("notif");
    if (notifOpen) pushOverlay("notif", function () { toggleNotif(false); });
    drawBell();
    drawNotif();
    if (notifOpen) { var h = notifHost.querySelector("h2"); if (h) { h.setAttribute("tabindex", "-1"); h.focus(); } }
    else bellBtn.focus();
  }

  var palette = null;
  function closePalette() {
    if (!palette) return;
    palette.remove();
    palette = null;
    dropOverlay("palette");
  }
  function commands(q, searching) {
    var extra = [];
    if (searching && q) {
      list.forEach(function (t) {
        extra.push({ id: "search:" + t.id, label: "Search " + t.plural + " for " + q, href: "#/browse/" + encodeURIComponent(t.id) + "?q=" + encodeURIComponent(q) });
      });
    }
    var page = typeof ctx.pageCommands === "function" ? ctx.pageCommands() || [] : [];
    return extra.concat(paletteCommands(navModel(ctx.definition, savedViews, pins, ctx.join), page.concat([
      { id: "theme", label: "Change theme (now " + theme + ")", run: nextTheme },
      { id: "density", label: "Change density (now " + density + ")", run: function () { setDensity(density === "compact" ? "comfortable" : "compact"); } },
      { id: "sidebar", label: "Full or slim sidebar", run: toggleSidebar },
      { id: "notifications", label: "Open notifications", run: function () { toggleNotif(true); } },
      { id: "views", label: "Go to all views", href: "#/views" },
      { id: "suggestions", label: "Go to suggestions", href: "#/suggestions" },
      { id: "help", label: "Keyboard shortcuts", run: openHelp },
    ])));
  }
  function openPalette(q, searching) {
    closePalette();
    palette = paletteDialog({
      commands: commands(q, searching), query: searching ? "search " + (q || "") : q || "",
      onPick: function (c) {
        closePalette();
        if (c.href) location.hash = c.href;
        else if (c.run) c.run();
      },
      onClose: closePalette,
    });
    append(root, palette);
    pushOverlay("palette", closePalette);
    palette.focusInput();
  }

  var help = null;
  function closeHelp() { if (help) { help.remove(); help = null; dropOverlay("help"); } }
  function openHelp() {
    closeHelp();
    var rows = shortcutRows(list);
    help = el("div", { class: "pal-back", onmousedown: function (e) { if (e.target === help) closeHelp(); } },
      el("div", { class: "pal keys-dialog", role: "dialog", "aria-label": "Keyboard shortcuts" },
        el("div", { class: "notif-head" }, el("h2", null, "Keyboard shortcuts"), button("Close", closeHelp, { icon: "x", iconOnly: true })),
        el("dl", { class: "keys" }, rows.map(function (r) { return [el("dt", null, r[1]), el("dd", null, el("span", { class: "kbd" }, r[0]))]; })),
        el("p", { class: "muted" }, "Shortcuts never fire while you type in a field.")));
    append(root, help);
    pushOverlay("help", closeHelp);
    help.querySelector("button").focus();
  }

  var gAt = 0;
  function onKey(e) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && String(e.key).toLowerCase() === "k") {
      e.preventDefault();
      if (palette) closePalette(); else openPalette("");
      return;
    }
    if (e.key === "Escape") {
      var o = overlays.pop();
      if (o) { e.preventDefault(); o.close(); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || palette || help) return;
    var key = String(e.key).length === 1 ? String(e.key).toLowerCase() : "";
    if (!key) return;
    var keys = gAt && Date.now() - gAt < G_WAIT_MS ? ["g", key] : [key];
    gAt = 0;
    var hit = shortcutFor(keys, list);
    if (!hit && keys.length === 2) hit = shortcutFor([key], list);
    if (!hit) return;
    e.preventDefault();
    if (hit.pending) { gAt = Date.now(); return; }
    if (hit.go) { location.hash = hit.go; return; }
    if (hit.run === "search") {
      if (!app.contains(searchInput)) return;
      searchInput.focus();
    } else if (hit.run === "filters") {
      var f = outlet.querySelector("details.filter-panel");
      if (f) { f.open = true; var s = f.querySelector("summary"); if (s) s.focus(); }
    } else if (hit.run === "notifications") {
      if (app.contains(bellBtn)) toggleNotif();
    } else if (hit.run === "sidebar") toggleSidebar();
    else if (hit.run === "help") openHelp();
  }
  document.addEventListener("keydown", onKey);

  var stop = null;
  function render() {
    if (stop) stop();
    stop = null;
    ctx.pageCommands = null;
    var r = route();
    current = r;
    // Old #/runs addresses keep working: the address bar is swapped for the History one, no extra entry.
    if (r.redirect && globalThis.history && history.replaceState) history.replaceState(null, "", r.redirect);
    setDrawer(false);
    markCurrent();
    drawSearch();
    var title = pageTitle(r, ctx.definition);
    pageName.textContent = title;
    clear(outlet);
    if (ctx.failed) {
      append(outlet, ctx.failed === "no-db" ? stateView("no-db")
        : stateView("read-error", { collection: "the workspace", whole: true, onRetry: ctx.reload }));
      return;
    }
    if (ctx.loading) {
      append(outlet, stateView("loading", { label: "the workspace" }));
      return;
    }
    if (!ctx.definition) {
      append(outlet, stateView("not-set-up", { name: ctx.workspace && ctx.workspace.name }));
      return;
    }
    var renderPage = ctx.pages && ctx.pages[r.page];
    // Disabled actions carry the note only as a tooltip, which touch screens never show; say it once per page.
    if (ctx.store && ctx.store.readOnly) append(outlet, stateView("read-only"));
    if (renderPage) stop = renderPage(outlet, ctx, r.params) || null;
    else append(outlet, el("h1", null, title));
  }
  drawNav();
  drawBell();

  // Saved views and pins feed the sidebar; the feed is derived on every change (spec "Notifications").
  var stopShell = null;
  if (ctx.definition && ctx.store && !ctx.loading && !ctx.failed) {
    var specs = withViewerState(ctx, {
      views: { collection: "views" }, inbox: { collection: "inbox" }, pending: { collection: "pending" },
      decisions: { collection: "decisions" }, runs: { collection: "runs" },
    }, ["read", "pin"]);
    stopShell = watchAll(ctx, specs, function (got) {
      savedViews = got.views || [];
      pins = idSet(got.pin);
      feed = deriveNotifications({
        inbox: got.inbox, pending: got.pending, decisions: idSet(got.decisions), runs: got.runs,
        producers: ctx.definition.producers || [], read: idSet(got.read) || new Set(),
      });
      drawNav();
      drawBell();
      if (notifOpen) drawNotif();
    });
  }

  // A page's read error offers Try again, which draws the current route afresh.
  ctx.retry = render;
  window.addEventListener("hashchange", render);
  render();
  mounted = {
    render: render,
    unmount: function () {
      window.removeEventListener("hashchange", render);
      document.removeEventListener("keydown", onKey);
      if (stopShell) stopShell();
      if (stop) stop();
    },
  };
  return mounted;
}

function readConfig() {
  var node = document.getElementById("desk-config");
  try { return JSON.parse(node ? node.textContent : "{}"); } catch (e) { return {}; }
}

function boot() {
  var root = document.getElementById("desk-root");
  if (!root) return;
  var cfg = readConfig();
  var store = cfg.store === "static"
    ? createStore("static", { url: cfg.snapshot })
    : createStore("db", {});
  var ctx = {
    store: store, definition: null, workspace: { name: cfg.workspace }, viewer: null, loading: true,
    pages: {
      today: renderToday, inbox: renderInbox, approvals: renderApprovals, suggestions: renderSuggestions, browse: renderBrowse, entity: renderEntity,
      views: renderViews, runs: renderRuns, history: renderHistory, run: renderRun, settings: renderSettings, workers: renderWorkers,
    },
  };
  // No viewer id means no per-viewer state this visit; it never falls back to browser storage.
  function load() {
    ctx.loading = true;
    ctx.failed = null;
    mount(root, ctx);
    var viewer = store.viewer().catch(function () { return null; });
    Promise.all([store.get("meta/definition"), store.get("meta/workspace"), viewer, store.get("meta/join"), store.get("meta/owner")]).then(function (docs) {
      ctx.definition = docs[0].exists ? docs[0].data : null;
      if (docs[1].exists) ctx.workspace = docs[1].data;
      ctx.viewer = docs[2] || null;
      ctx.join = docs[3].exists && docs[3].data && typeof docs[3].data === "object" ? docs[3].data : null;
      ctx.owner = docs[4].exists && docs[4].data && typeof docs[4].data.by === "string" ? docs[4].data : null;
      ctx.ownerTampered = false;
      // The owner's first visit records meta/owner; owner-only controls appear once it is known.
      return ensureOwner(ctx).then(function () {
        ctx.loading = false;
        mount(root, ctx);
      });
    }, function (e) {
      ctx.failed = e instanceof NoDbError ? "no-db" : "read-error";
      ctx.loading = false;
      mount(root, ctx);
    });
  }
  ctx.reload = load;
  load();
}

boot();
