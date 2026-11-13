// blueprint/kinds.js: a generic icon per node kind (spec 6.2a) and a Mantine colour per state.
import {
  IconClock, IconDatabase, IconKey, IconLayoutDashboard, IconListDetails, IconPlug, IconRobot, IconRoute, IconServer,
  IconSettings, IconShieldCheck, IconWorld,
} from "@tabler/icons-react";

export var KIND_ICON = {
  trigger: IconClock,
  routine: IconRoute,
  stage: IconListDetails,
  connector: IconPlug,
  mcp: IconRobot,
  http: IconWorld,
  infra: IconServer,
  store: IconDatabase,
  gate: IconShieldCheck,
  output: IconLayoutDashboard,
  setting: IconSettings,
  secret: IconKey,
};

export var STATE_COLOR = {
  verified: "green",
  docs: "blue",
  unverified: "yellow",
  "needs-research": "orange",
  "needs-building": "grape",
  conflict: "red",
  null: "gray",
};

export var STATE_LABEL = {
  verified: "verified",
  docs: "docs",
  unverified: "unverified",
  "needs-research": "needs research",
  "needs-building": "needs building",
  conflict: "conflict",
  null: "declared",
};
