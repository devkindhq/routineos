// app/pages/Settings.jsx: the Settings page. A sub-nav of sections (core/pages/settings.js SETTINGS_NAV), grouped into
// what belongs to this browser and what belongs to the workspace, and the section for #/settings/<section>.
import { Grid, NavLink, Stack, Text, Title } from "@mantine/core";
import { SETTINGS_NAV } from "../../core/pages/settings.js";
import About from "../settings/about.jsx";
import Appearance from "../settings/appearance.jsx";
import Export from "../settings/export.jsx";
import SettingsHistory from "../settings/history.jsx";
import Lock from "../settings/lock.jsx";
import Members from "../settings/members.jsx";
import Modules from "../settings/modules.jsx";
import Notifications from "../settings/notifications.jsx";
import RoutineNotifications from "../settings/routine-notifications.jsx";
import Routine from "../settings/routine.jsx";
import Shortcuts from "../settings/shortcuts.jsx";
import Tour from "../settings/tour.jsx";
import Views from "../settings/views.jsx";

var SECTIONS = {
  appearance: Appearance, shortcuts: Shortcuts, routine: Routine, notifications: Notifications,
  "routine-notifications": RoutineNotifications, members: Members, modules: Modules, views: Views, lock: Lock,
  tour: Tour, export: Export, history: SettingsHistory, about: About,
};

var GROUPS = [["account", "Account"], ["workspace", "Workspace"]];

export default function Settings({ route }) {
  var id = route.params.section;
  if (!Object.prototype.hasOwnProperty.call(SECTIONS, id)) id = "appearance";
  var current = id === "notifications" ? "routine-notifications" : id;
  var Body = SECTIONS[id];
  return (
    <Stack>
      <Title id="page-title" order={1}>Settings</Title>
      <Grid>
        <Grid.Col span={{ base: 12, sm: 3 }}>
          <nav aria-label="Settings sections">
            {GROUPS.map(([g, label]) => (
              <Stack key={g} gap={0} mb="sm">
                <Text size="xs" c="dimmed" fw={600} px="sm" py={4}>{label}</Text>
                {SETTINGS_NAV.filter((n) => n.group === g).map((n) => (
                  <NavLink key={n.id} href={"#/settings/" + n.id} label={n.label} active={current === n.id}
                    aria-current={current === n.id ? "page" : undefined} />
                ))}
              </Stack>
            ))}
          </nav>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 9 }}>
          <Body />
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
