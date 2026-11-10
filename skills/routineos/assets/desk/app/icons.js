// app/icons.js: the Desk's icon names (core/shared.js ICON_NAMES, the names definitions, views and modules may use)
// mapped to Tabler icons. An unknown name gets a neutral dot, so a bad name never blanks a row.
import {
  IconAlertTriangle, IconBell, IconBriefcase, IconBuilding, IconCalendar, IconChartLine, IconCheck, IconChevronDown,
  IconColumns3, IconDesk, IconDeviceDesktop, IconDownload, IconExternalLink, IconFileSearch, IconFileText, IconFilter,
  IconFolder, IconGitPullRequest, IconHelpCircle, IconHistory, IconHome, IconInbox, IconLayoutDashboard,
  IconLayoutRows, IconLayoutSidebar, IconLink, IconList, IconMail, IconMenu2, IconMessage, IconMoon, IconNews,
  IconPackage, IconPencil, IconPoint, IconPointFilled, IconReceipt, IconRosetteDiscountCheck, IconRss, IconSearch,
  IconSettings, IconSparkles, IconStar, IconStarFilled, IconSun, IconTag, IconUser, IconUsers, IconVideo, IconWorld,
  IconX,
} from "@tabler/icons-react";

export var ICONS = {
  "badge-check": IconRosetteDiscountCheck, bell: IconBell, briefcase: IconBriefcase, "building-2": IconBuilding,
  calendar: IconCalendar, "chart-line": IconChartLine, check: IconCheck, "chevron-down": IconChevronDown,
  "circle-help": IconHelpCircle, "columns-3": IconColumns3, desk: IconDesk, "desk-mark": IconLayoutDashboard,
  dot: IconPointFilled, download: IconDownload, "external-link": IconExternalLink, "file-search": IconFileSearch,
  "file-text": IconFileText, filter: IconFilter, folder: IconFolder, "git-pull-request": IconGitPullRequest,
  globe: IconWorld, history: IconHistory, house: IconHome, improve: IconSparkles, inbox: IconInbox, link: IconLink,
  list: IconList, mail: IconMail, menu: IconMenu2, "message-square": IconMessage, monitor: IconDeviceDesktop,
  moon: IconMoon, newspaper: IconNews, package: IconPackage, "panel-left": IconLayoutSidebar, pencil: IconPencil,
  receipt: IconReceipt, "rows-3": IconLayoutRows, rss: IconRss, search: IconSearch, settings: IconSettings,
  star: IconStar, "star-filled": IconStarFilled, sun: IconSun, tag: IconTag, "triangle-alert": IconAlertTriangle,
  user: IconUser, users: IconUsers, video: IconVideo, x: IconX,
};

export var FALLBACK_ICON = IconPoint;

export function icon(name) {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : FALLBACK_ICON;
}
