import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const prod = process.argv[2] === "production";
const empty = join(__dirname, "src", "empty-module.js");

// require.resolve("onnxruntime-web") returns the Node entry (ort.node.min.js).
// Obsidian's renderer needs the browser/WASM build.
const ortBrowser = join(
  __dirname,
  "node_modules",
  "onnxruntime-web",
  "dist",
  "ort.min.js"
);

const context = await esbuild.context({
  banner: {
    js: `/* Vault Organizer - MIT. Vendored model weights are Apache-2.0 (see THIRD_PARTY_LICENSES.md). */`,
  },
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "browser",
  mainFields: ["browser", "module", "main"],
  conditions: ["browser", "import", "default"],
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
  alias: {
    // Electron looks like Node; force both ORT packages to the browser build.
    "onnxruntime-node": ortBrowser,
    "onnxruntime-web": ortBrowser,
    sharp: empty,
  },
  define: {
    "process.env.NODE_ENV": prod ? '"production"' : '"development"',
  },
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
