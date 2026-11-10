import "@mantine/core/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/notifications/styles.css";
import "mantine-datatable/styles.css";
import { createRoot } from "react-dom/client";
import { readConfig } from "../core/prefs.js";
import { createStore } from "../core/store.js";
import App from "./App.jsx";

const config = readConfig(document.getElementById("desk-config"));
const store = config.store === "static" ? createStore("static", { url: config.snapshot }) : createStore("db", {});

createRoot(document.getElementById("root")).render(<App store={store} config={config} />);
