// app/App.jsx: the providers (prefs, Mantine theme and color scheme, notifications, the store) around the shell.
import { useEffect, useMemo } from "react";
import { MantineProvider } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Notifications } from "@mantine/notifications";
import Approvals from "./pages/Approvals.jsx";
import Browse from "./pages/Browse.jsx";
import Ext from "./pages/Ext.jsx";
import SpecPage from "./pages/SpecPage.jsx";
import Entity from "./pages/Entity.jsx";
import History from "./pages/History.jsx";
import Runs from "./pages/Runs.jsx";
import RunsHealth from "./pages/RunsHealth.jsx";
import Settings from "./pages/Settings.jsx";
import Today from "./pages/Today.jsx";
import Workers from "./pages/Workers.jsx";
import Shell, { PAGES } from "./Shell.jsx";
import { applyZoomLock } from "./zoomlock.js";
import { StoreProvider } from "./StoreContext.jsx";
import { PrefsProvider, TOUCH_QUERY, deskSchemeManager, themeFor, usePrefs } from "./usePrefs.js";

PAGES.browse = Browse;
PAGES.module = Browse;
PAGES.entity = Entity;
PAGES.ext = Ext;
PAGES.spec = SpecPage;
PAGES.approvals = Approvals;
PAGES.today = Today;
PAGES.history = History;
PAGES.runs = RunsHealth;
PAGES.run = Runs;
PAGES.workers = Workers;
PAGES.settings = Settings;

// Dimmed and link text at 4.5:1 on the page background (WCAG AA): one step darker in light, one lighter in dark.
function contrastVars(theme) {
  return {
    variables: {},
    light: { "--mantine-color-dimmed": "var(--mantine-color-gray-7)", "--mantine-color-anchor": "var(--mantine-color-" + theme.primaryColor + "-8)" },
    dark: { "--mantine-color-dimmed": "var(--mantine-color-dark-1)" },
  };
}

function Themed({ children }) {
  const prefs = usePrefs();
  const touch = useMediaQuery(TOUCH_QUERY, false, { getInitialValueInEffect: false });
  const theme = useMemo(() => themeFor(prefs, { touch: touch }), [prefs.density, prefs.motion, touch]);
  useEffect(() => { applyZoomLock(prefs.zoom === "lock"); }, [prefs.zoom]);
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto" colorSchemeManager={deskSchemeManager} cssVariablesResolver={contrastVars}>
      <Notifications />
      {children}
    </MantineProvider>
  );
}

export function DeskProviders({ store, children }) {
  return (
    <PrefsProvider>
      <Themed>
        <StoreProvider store={store}>{children}</StoreProvider>
      </Themed>
    </PrefsProvider>
  );
}

export default function App({ store, config }) {
  return (
    <DeskProviders store={store}>
      <Shell config={config} />
    </DeskProviders>
  );
}
