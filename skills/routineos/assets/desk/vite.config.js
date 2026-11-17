import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const DIR = import.meta.dirname;

// Vite puts the inlined entry module in <head>. Move it to the end of <body> so that custom component
// scripts inserted at the desk-components marker come before it in the file.
export function moveModuleToBody(html) {
  const start = html.indexOf('<script type="module"');
  if (start < 0) return html;
  const end = html.indexOf("</script>", start) + "</script>".length;
  const script = html.slice(start, end);
  const rest = html.slice(0, start) + html.slice(end);
  const close = rest.lastIndexOf("</body>");
  return rest.slice(0, close) + script + "\n" + rest.slice(close);
}

// The build inputs, hashed the same way as bundle_desk.src_hash: each file's "/" relative path and bytes, sorted by
// path, dotfiles skipped. The hash goes into the page so Python can tell a stale committed build without node.
const HASH_DIRS = ["core", "app"];
const HASH_FILES = ["package.json", "package-lock.json", "vite.config.js", "index.template.html", "libraries.json"];
// The Blueprint variant also builds blueprint/ and its own template, so its hash covers them.
const BLUEPRINT_DIRS = [...HASH_DIRS, "blueprint"];
const BLUEPRINT_FILES = [...HASH_FILES, "blueprint.template.html"];

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

export function srcHash(root, dirs = HASH_DIRS, files = HASH_FILES) {
  const paths = files.filter((f) => existsSync(join(root, f)));
  for (const top of dirs) {
    if (existsSync(join(root, top))) {
      for (const path of walk(join(root, top), [])) paths.push(relative(root, path).split(sep).join("/"));
    }
  }
  // Byte order, as Python sorts str; the paths are ASCII.
  paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const hash = createHash("sha256");
  for (const rel of paths) {
    hash.update(Buffer.from(rel, "utf8"));
    hash.update(Buffer.from([0]));
    hash.update(readFileSync(join(root, rel)));
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

function srcHashMeta(dirs, files) {
  return {
    name: "desk-src-hash",
    transformIndexHtml(html) {
      return html.replace("</title>", `</title>\n    <meta name="desk-src-hash" content="${srcHash(DIR, dirs, files)}">`);
    },
  };
}

// Each build has one HTML entry. Vite names the output after the entry file, so rewrite it under its final name.
// The main build is copied to desk/index.html and the Blueprint build to desk/index.blueprint.html, the committed pages
// Python injects into.
function finishOutput(from, to, copy) {
  return {
    name: "desk-finish-output",
    closeBundle() {
      const src = resolve(DIR, "dist", from);
      const html = moveModuleToBody(readFileSync(src, "utf8"));
      rmSync(src);
      rmSync(resolve(DIR, "dist", "probe"), { recursive: true, force: true });
      writeFileSync(resolve(DIR, "dist", to), html);
      if (copy) writeFileSync(resolve(DIR, copy), html);
    },
  };
}

// The library registry (libraries.json, spec 16) becomes the virtual module behind app/deskLib.js: one namespace per
// entry keyed by specifier (an entry with an "exports" list gets an object of only those names), plus its stylesheet.
// buildStart also writes lib-exports.json, the names each entry exposes, read from the real package in node.
const VIRTUAL_LIB = "virtual:desk-lib";
const IDENT = /^[A-Za-z_$][\w$]*$/;

function readRegistry() {
  return JSON.parse(readFileSync(resolve(DIR, "libraries.json"), "utf8")).libraries;
}

export function deskLibModule(entries) {
  const lines = [];
  const keys = [];
  entries.forEach((e, i) => {
    if (Array.isArray(e.exports)) {
      lines.push(`import { ${e.exports.join(", ")} } from ${JSON.stringify(e.package)};`);
      lines.push(`const ns${i} = { ${e.exports.join(", ")} };`);
    } else {
      lines.push(`import * as ns${i} from ${JSON.stringify(e.package)};`);
    }
    if (e.css) lines.push(`import ${JSON.stringify(e.css)};`);
    keys.push(`  ${JSON.stringify(e.specifier)}: ns${i},`);
  });
  return `${lines.join("\n")}\nexport default {\n${keys.join("\n")}\n};\n`;
}

export async function libExports(entries) {
  const exports = {};
  for (const e of entries) {
    let names;
    try {
      names = Object.keys(await import(e.package)).filter((n) => IDENT.test(n));
    } catch (err) {
      throw new Error(`libraries.json: ${e.specifier}: cannot import ${e.package} in node to list its exports: ${err.message}`);
    }
    if (Array.isArray(e.exports)) {
      const missing = e.exports.filter((n) => !names.includes(n));
      if (missing.length) throw new Error(`libraries.json: ${e.specifier} does not export ${missing.join(", ")}`);
      names = e.exports;
    }
    exports[e.specifier] = [...new Set(names)].sort();
  }
  return { version: 1, exports };
}

function deskLibPlugin() {
  return {
    name: "desk-lib",
    async buildStart() {
      const text = JSON.stringify(await libExports(readRegistry()), null, 2) + "\n";
      const path = resolve(DIR, "lib-exports.json");
      if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text);
    },
    resolveId(id) {
      return id === VIRTUAL_LIB ? "\0" + VIRTUAL_LIB : null;
    },
    load(id) {
      return id === "\0" + VIRTUAL_LIB ? deskLibModule(readRegistry()) : null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const probe = mode === "probe";
  const blueprint = mode === "blueprint";
  const entry = blueprint ? "blueprint.template.html" : "index.template.html";
  return {
    root: DIR,
    base: "./",
    plugins: [
      react(),
      deskLibPlugin(),
      viteSingleFile({ removeViteModuleLoader: true }),
      ...(probe ? [finishOutput("probe/index.html", "probe.html")]
        : blueprint ? [srcHashMeta(BLUEPRINT_DIRS, BLUEPRINT_FILES), finishOutput(entry, "index.blueprint.html", "index.blueprint.html")]
        : [srcHashMeta(HASH_DIRS, HASH_FILES), finishOutput(entry, "index.html", "index.html")]),
    ],
    build: {
      outDir: "dist",
      emptyOutDir: false,
      modulePreload: { polyfill: false },
      rolldownOptions: {
        input: resolve(DIR, probe ? "probe/index.html" : entry),
        // Escape non-ASCII in the script (Mantine's CSS id escaper holds a literal U+FFFD once minified).
        output: { charset: "ascii" },
      },
    },
    test: {
      environment: "jsdom",
      include: ["test/**/*.test.{js,jsx}"],
      setupFiles: ["test/setup.js"],
    },
  };
});
