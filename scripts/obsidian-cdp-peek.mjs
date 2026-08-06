/** Quick CDP status peek with short timeouts. */
const DEBUG = process.env.OBSIDIAN_CDP || "http://127.0.0.1:9222";

async function main() {
  const targets = await (await fetch(`${DEBUG}/json/list`)).json();
  const page = targets.find(
    (t) => t.type === "page" && t.webSocketDebuggerUrl && (t.title || "").includes("Obsidian")
  );
  if (!page) throw new Error("no page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", j, { once: true });
  });
  let id = 1;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
    if (m.id != null && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  });
  const send = (method, params = {}, timeoutMs = 8000) =>
    new Promise((resolve, reject) => {
      const i = id++;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => {
        if (pending.has(i)) {
          pending.delete(i);
          reject(new Error(`timeout ${method}`));
        }
      }, timeoutMs);
    });
  const ev = async (expression, timeoutMs = 8000) => {
    const r = await send(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      timeoutMs
    );
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  await send("Runtime.enable");
  const bar = await ev(
    `(document.querySelector(".status-bar")?.innerText || "").slice(0, 400)`
  ).catch((e) => `ERR ${e.message}`);
  const modal = await ev(
    `(document.querySelector(".modal-content")?.innerText || "").slice(0, 800)`
  ).catch((e) => `ERR ${e.message}`);
  const notice = await ev(
    `[...document.querySelectorAll(".notice")].map(n=>n.innerText).join(" | ").slice(0,400)`
  ).catch((e) => `ERR ${e.message}`);
  console.log(JSON.stringify({ bar, modal, notice }, null, 2));
  ws.close();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
