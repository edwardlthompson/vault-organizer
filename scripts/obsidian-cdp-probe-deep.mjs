/** Deep probe: reload, log wasmPaths, capture full ONNX error. */
const DEBUG = process.env.OBSIDIAN_CDP || "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const targets = await (await fetch(`${DEBUG}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
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
    if (msg.method === "Runtime.consoleAPICalled") {
      const args = (msg.params?.args || []).map((a) => a.value ?? a.description).join(" ");
      console.log("[console]", msg.params?.type, args);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, send };
}

let { ws, send } = await connect();
await send("Runtime.enable");
await send("Runtime.evaluate", {
  expression: `app.commands.executeCommandById("app:reload")`,
  returnByValue: true,
});
ws.close();
await sleep(12000);

({ ws, send } = await connect());
await send("Runtime.enable");
await sleep(6000);

const result = await send("Runtime.evaluate", {
  expression: `(() => {
    const p = app.plugins.plugins["vault-organizer"];
    const onnx = globalThis.__transformers_env_backends_onnx
      || (typeof window !== "undefined" && null);
    let backends = null;
    try {
      // pull from plugin closure if exposed
      backends = p?.embedStatus || null;
    } catch {}
    return {
      embedStatus: p?.embedStatus ?? null,
      processType: typeof process !== "undefined" ? process.type : "no-process",
      processRelease: typeof process !== "undefined" ? process.release?.name : null,
    };
  })()`,
  returnByValue: true,
});
console.log("status", JSON.stringify(result.result?.value ?? result, null, 2));

// Force reload embedder with extra logging
const force = await send("Runtime.evaluate", {
  expression: `(async () => {
    const p = app.plugins.plugins["vault-organizer"];
    if (!p) return { err: "no plugin" };
    // Re-run createProductionEmbedder path via reloadEmbedder if present
    if (typeof p.reloadEmbedder === "function") {
      await p.reloadEmbedder();
      return { embedStatus: p.embedStatus };
    }
    return { err: "no reloadEmbedder", keys: Object.getOwnPropertyNames(Object.getPrototypeOf(p)).slice(0,40) };
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log("force", JSON.stringify(force.result?.value ?? force, null, 2));
ws.close();
