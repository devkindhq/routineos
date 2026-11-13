// blueprint/main.jsx: the Desk with the Blueprint page added (the build variant, spec 6.1). The main entry is app/main.jsx.
import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/notifications/styles.css";
import "mantine-datatable/styles.css";
import "@xyflow/react/dist/style.css";
import { createRoot } from "react-dom/client";
import { readConfig } from "../core/prefs.js";
import { createStore } from "../core/store.js";
import App from "../app/App.jsx";
import "./register.js";

const config = readConfig(document.getElementById("desk-config"));
const store = config.store === "static" ? createStore("static", { url: config.snapshot }) : createStore("db", {});

createRoot(document.getElementById("root")).render(<App store={store} config={config} />);
