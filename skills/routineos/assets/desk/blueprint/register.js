// blueprint/register.js: adds the Blueprint page to the Desk. It is a built-in page, so there is no component to approve.
// App.jsx fills PAGES first; #/x/blueprint is then drawn here and every other #/x/<name> by the existing Ext page.
import { createElement } from "react";
import "../app/App.jsx";
import { PAGES } from "../app/Shell.jsx";
import { readConfig } from "../core/prefs.js";
import Blueprint from "./Blueprint.jsx";

var graph = readConfig(document.getElementById("desk-config")).blueprint || null;
var Ext = PAGES.ext;

PAGES.ext = function BlueprintOrExt(props) {
  if (props.route && props.route.params && props.route.params.name === "blueprint") return createElement(Blueprint, { graph: graph });
  return createElement(Ext, props);
};

window.DESK_EXTENSIONS = window.DESK_EXTENSIONS || {};
window.DESK_EXTENSIONS.blueprint = { slot: "page", nav: true, title: "Blueprint" };
