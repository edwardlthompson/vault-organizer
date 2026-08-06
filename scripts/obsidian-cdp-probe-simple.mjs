const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
let id = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.consoleAPICalled") {
    const args = (m.params?.args || []).map((a) => a.value ?? a.description).join(" ");
    console.log("[console]", m.params.type, args);
  }
  if (m.id != null && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = id++;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => {
      if (pending.has(i)) {
        pending.delete(i);
        reject(new Error("timeout " + method));
      }
    }, 30000);
  });

await send("Runtime.enable");
const before = await send("Runtime.evaluate", {
  expression: `JSON.stringify(app.plugins.plugins["vault-organizer"]?.embedStatus || null)`,
  returnByValue: true,
});
console.log("before", before.result.value);

console.log("Reloading app...");
await send("Runtime.evaluate", {
  expression: `app.commands.executeCommandById("app:reload")`,
  returnByValue: true,
});
ws.close();

await new Promise((r) => setTimeout(r, 12000));

const targets2 = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page2 = targets2.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws2 = new WebSocket(page2.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws2.addEventListener("open", res, { once: true });
  ws2.addEventListener("error", rej, { once: true });
});
let id2 = 1;
const pending2 = new Map();
ws2.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.consoleAPICalled") {
    const args = (m.params?.args || []).map((a) => a.value ?? a.description).join(" ");
    console.log("[console]", m.params.type, args);
  }
  if (m.id != null && pending2.has(m.id)) {
    const { resolve, reject } = pending2.get(m.id);
    pending2.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send2 = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = id2++;
    pending2.set(i, { resolve, reject });
    ws2.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => {
      if (pending2.has(i)) {
        pending2.delete(i);
        reject(new Error("timeout " + method));
      }
    }, 30000);
  });

await send2("Runtime.enable");
await new Promise((r) => setTimeout(r, 8000));
const after = await send2("Runtime.evaluate", {
  expression: `JSON.stringify(app.plugins.plugins["vault-organizer"]?.embedStatus || null)`,
  returnByValue: true,
});
console.log("after", after.result.value);
ws2.close();
