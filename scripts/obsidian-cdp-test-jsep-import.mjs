/** Isolate: can Obsidian dynamic-import the patched ORT jsep blob? */
const DEBUG = process.env.OBSIDIAN_CDP || "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`${DEBUG}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) throw new Error("no page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id != null && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("timeout " + method));
      }
    }, 60000);
  });

await send("Runtime.enable");
const result = await send("Runtime.evaluate", {
  awaitPromise: true,
  returnByValue: true,
  expression: `(async () => {
    const fs = require("fs");
    const path = require("path");
    const jsep = path.join(
      app.vault.adapter.basePath,
      ".obsidian/plugins/vault-organizer/wasm/ort-wasm-simd-threaded.jsep.mjs"
    );
    const wasm = path.join(
      app.vault.adapter.basePath,
      ".obsidian/plugins/vault-organizer/wasm/ort-wasm-simd-threaded.jsep.wasm"
    );
    const exists = { jsep: fs.existsSync(jsep), wasm: fs.existsSync(wasm) };
    const txt = fs.readFileSync(jsep, "utf8");
    const hasLiveImport = /import\\(['"]worker_threads['"]\\)/.test(txt);
    const hasNFalse = txt.includes("n=false");
    const blob = URL.createObjectURL(new Blob([txt], { type: "text/javascript" }));
    let importErr = null;
    let importOk = false;
    try {
      const mod = await import(blob);
      importOk = !!mod;
    } catch (e) {
      importErr = String(e && e.message ? e.message : e);
    }
    // Also try ORT init with wasmPaths
    let ortErr = null;
    let ortOk = false;
    try {
      // Use the same onnxruntime the plugin bundles via a fresh eval of global if any
      const ort = await import("onnxruntime-web").catch(() => null);
      ortErr = ort ? "imported-ort-unexpectedly" : "cannot-import-ort-from-page";
    } catch (e) {
      ortErr = String(e && e.message ? e.message : e);
    }
    return { exists, hasLiveImport, hasNFalse, importOk, importErr, ortErr, blob: blob.slice(0, 40) };
  })()`,
});
console.log(JSON.stringify(result.result?.value ?? result, null, 2));
ws.close();
