/** Reload plugin path and probe ORT / embedder status. */
const DEBUG = process.env.OBSIDIAN_CDP || "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`${DEBUG}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const logs = [];
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
    logs.push(`${msg.params?.type}: ${args}`);
    console.log("[console]", msg.params?.type, args);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("timeout " + method));
      }
    }, 120000);
  });
}

await send("Runtime.enable");
await send("Log.enable");

console.log("Reloading...");
await send("Runtime.evaluate", {
  expression: `app.commands.executeCommandById("app:reload")`,
  returnByValue: true,
});
ws.close();
await sleep(10000);

const targets2 = await (await fetch(`${DEBUG}/json/list`)).json();
const page2 = targets2.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws2 = new WebSocket(page2.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws2.addEventListener("open", resolve, { once: true });
  ws2.addEventListener("error", reject, { once: true });
});
let nextId2 = 1;
const pending2 = new Map();
ws2.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id != null && pending2.has(msg.id)) {
    const { resolve, reject } = pending2.get(msg.id);
    pending2.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    const args = (msg.params?.args || []).map((a) => a.value ?? a.description).join(" ");
    console.log("[console]", msg.params?.type, args);
  }
});
function send2(method, params = {}) {
  const id = nextId2++;
  return new Promise((resolve, reject) => {
    pending2.set(id, { resolve, reject });
    ws2.send(JSON.stringify({ id, method, params }));
  });
}
await send2("Runtime.enable");
await sleep(5000);

const result = await send2("Runtime.evaluate", {
  expression: `(() => {
    const sym = Symbol.for("onnxruntime");
    const ort = globalThis[sym];
    const p = app.plugins.plugins["vault-organizer"];
    return {
      hasOrtSymbol: !!ort,
      ortKeys: ort ? Object.keys(ort).slice(0, 30) : [],
      hasInferenceSession: !!(ort && ort.InferenceSession),
      embedStatus: p?.embedStatus ?? null,
    };
  })()`,
  returnByValue: true,
});
console.log(JSON.stringify(result.result?.value ?? result, null, 2));
ws2.close();
