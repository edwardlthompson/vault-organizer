/** Quick CDP probe of Vault Organizer plugin state. */
const DEBUG = process.env.OBSIDIAN_CDP || "http://127.0.0.1:9222";

const res = await fetch(`${DEBUG}/json/list`);
const targets = await res.json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) throw new Error("No Obsidian page target");

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

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Runtime.enable");
const result = await send("Runtime.evaluate", {
  expression: `(() => {
    const p = app.plugins.plugins["vault-organizer"];
    return {
      embedStatus: p?.embedStatus ?? null,
      hasIndex: !!p?.index,
      statusBar: (document.querySelector(".status-bar")?.innerText || "").slice(0, 300),
      notices: [...document.querySelectorAll(".notice")].map((n) => n.innerText).slice(0, 5),
    };
  })()`,
  returnByValue: true,
  awaitPromise: false,
});

console.log(JSON.stringify(result.result?.value ?? result, null, 2));
ws.close();
