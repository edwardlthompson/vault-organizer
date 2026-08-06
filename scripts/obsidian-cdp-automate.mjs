/**
 * Automate Obsidian Vault Organizer via CDP:
 * reload plugins (Ctrl+R equivalent), rebuild index, organize vault, capture console.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEBUG = process.env.OBSIDIAN_CDP || "http://127.0.0.1:9222";
const OUT = process.env.OUT_LOG || join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "obsidian-cdp-console.log");
const PLUGIN = "vault-organizer";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTargets() {
  const res = await fetch(`${DEBUG}/json/list`);
  if (!res.ok) throw new Error(`CDP list failed: ${res.status}`);
  return res.json();
}

async function waitForTarget(timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const targets = await getTargets();
      // Prefer Obsidian vault page (not DevTools, not chrome-extension)
      const page =
        targets.find(
          (t) =>
            t.type === "page" &&
            t.webSocketDebuggerUrl &&
            (t.title?.includes("Obsidian") || t.url?.includes("app://") || t.url?.startsWith("file://"))
        ) ||
        targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl) ||
        targets.find((t) => t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // not ready
    }
    await sleep(1000);
  }
  throw new Error("Timed out waiting for Obsidian CDP target");
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.consoleLines = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        this.events.push(msg);
        if (
          msg.method === "Runtime.consoleAPICalled" ||
          msg.method === "Log.entryAdded" ||
          msg.method === "Runtime.exceptionThrown"
        ) {
          const line = formatConsole(msg);
          this.consoleLines.push(line);
          console.log("[obsidian]", line);
        }
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 3_600_000);
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          "evaluate failed"
      );
    }
    return result.result?.value;
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

function formatConsole(msg) {
  const ts = new Date().toISOString();
  if (msg.method === "Runtime.consoleAPICalled") {
    const type = msg.params?.type || "log";
    const args = (msg.params?.args || [])
      .map((a) => a.value ?? a.description ?? a.type)
      .join(" ");
    return `${ts} [${type}] ${args}`;
  }
  if (msg.method === "Log.entryAdded") {
    const e = msg.params?.entry || {};
    return `${ts} [log:${e.level}] ${e.text}`;
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params?.exceptionDetails;
    return `${ts} [exception] ${d?.exception?.description || d?.text || JSON.stringify(d)}`;
  }
  return `${ts} ${msg.method} ${JSON.stringify(msg.params)}`;
}

async function waitUntil(cdp, expression, { timeoutMs = 600_000, intervalMs = 2000, label = "condition" } = {}) {
  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await cdp.evaluate(expression, false);
      if (ok) return true;
      const now = Date.now();
      if (now - lastLog > 15_000) {
        lastLog = now;
        const phase = await cdp.evaluate(`window.__voAuto?.phase || "n/a"`, false).catch(() => "?");
        const status = await cdp
          .evaluate(`(document.querySelector(".status-bar")?.innerText || "").slice(0, 200)`, false)
          .catch(() => "");
        console.log(`[wait ${label}] ${(now - start) / 1000}s phase=${phase} status=${JSON.stringify(status)}`);
      }
    } catch (e) {
      console.log(`[wait ${label}] evaluate error:`, e.message);
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  console.log("Waiting for Obsidian CDP at", DEBUG);
  const target = await waitForTarget();
  console.log("Connected target:", target.title, target.url);

  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  try {
    await cdp.send("Console.enable");
  } catch {
    /* optional */
  }

  // Wait for Obsidian app + plugin
  console.log("Waiting for app + Vault Organizer plugin...");
  await waitUntil(
    cdp,
    `!!(window.app && app.plugins && app.plugins.plugins && app.plugins.plugins["${PLUGIN}"])`,
    { timeoutMs: 180_000, label: "plugin loaded" }
  );

  const pluginEnabled = await cdp.evaluate(
    `!!(app.plugins.enabledPlugins && app.plugins.enabledPlugins.has("${PLUGIN}"))`
  );
  console.log("Plugin enabled:", pluginEnabled);
  if (!pluginEnabled) {
    await cdp.evaluate(`app.plugins.enablePlugin("${PLUGIN}")`);
    await sleep(3000);
  }

  // Soft reload plugins (equivalent to Ctrl+R for plugin code when hotreload present;
  // full app.reload is safer for our automation)
  console.log("Reloading Obsidian app...");
  // Don't await full navigation — fire reload then reconnect
  try {
    await cdp.evaluate(`app.commands.executeCommandById("app:reload")`, false);
  } catch (e) {
    console.log("app:reload via command failed, trying location.reload:", e.message);
    await cdp.send("Page.reload", { ignoreCache: true }).catch(() => {});
  }

  cdp.close();
  await sleep(8000);

  const target2 = await waitForTarget();
  const cdp2 = new CdpClient(target2.webSocketDebuggerUrl);
  await cdp2.connect();
  await cdp2.send("Runtime.enable");
  await cdp2.send("Log.enable");

  console.log("Waiting for plugin after reload...");
  await waitUntil(
    cdp2,
    `!!(window.app && app.plugins?.plugins?.["${PLUGIN}"])`,
    { timeoutMs: 180_000, label: "plugin after reload" }
  );

  // Give ONNX a moment to finish initial load from onload
  await sleep(5000);
  const status0 = await cdp2.evaluate(
    `JSON.stringify(app.plugins.plugins["${PLUGIN}"]?.embedStatus || null)`,
    false
  );
  console.log("Embed status after load:", status0);
  const parsed = JSON.parse(status0 || "null");
  if (!parsed || parsed.mode !== "onnx") {
    throw new Error(
      `Expected ONNX embedder, got: ${status0}. Aborting vault organize.`
    );
  }

  // Expose progress flag on window for polling
  await cdp2.evaluate(`
    (async () => {
      window.__voAuto = { phase: "idle", error: null, startedAt: Date.now() };
      const p = app.plugins.plugins["${PLUGIN}"];
      if (!p) throw new Error("plugin missing");
      const wrap = (name, fn) => async (...args) => {
        window.__voAuto.phase = name + ":start";
        try {
          const r = await fn.apply(p, args);
          window.__voAuto.phase = name + ":done";
          return r;
        } catch (e) {
          window.__voAuto.phase = name + ":error";
          window.__voAuto.error = String(e && e.message ? e.message : e);
          throw e;
        }
      };
      window.__voRebuild = wrap("rebuild", p.rebuildIndex);
      window.__voOrganize = wrap("organize", function() {
        return p.organizeMany(p.listMarkdownFiles(), false);
      });
      return true;
    })()
  `);

  console.log("Running Rebuild vault embedding index...");
  // Fire without awaiting the promise at CDP layer — poll __voAuto instead
  await cdp2.evaluate(`void window.__voRebuild(true)`, false);

  await waitUntil(
    cdp2,
    `window.__voAuto && (window.__voAuto.phase === "rebuild:done" || window.__voAuto.phase === "rebuild:error")`,
    { timeoutMs: 3_600_000, intervalMs: 5000, label: "rebuild complete" }
  );
  const rebuildPhase = await cdp2.evaluate(`window.__voAuto.phase`, false);
  const rebuildErr = await cdp2.evaluate(`window.__voAuto.error`, false);
  console.log("Rebuild phase:", rebuildPhase, rebuildErr || "");

  if (rebuildPhase === "rebuild:error") {
    throw new Error("Rebuild failed: " + rebuildErr);
  }

  console.log("Running Organize entire vault (review)...");
  await cdp2.evaluate(`void window.__voOrganize()`, false);

  await waitUntil(
    cdp2,
    `window.__voAuto && (window.__voAuto.phase === "organize:done" || window.__voAuto.phase === "organize:error")`,
    { timeoutMs: 3_600_000, intervalMs: 5000, label: "organize complete" }
  );
  const orgPhase = await cdp2.evaluate(`window.__voAuto.phase`);
  const orgErr = await cdp2.evaluate(`window.__voAuto.error`);
  console.log("Organize phase:", orgPhase, orgErr || "");

  // Snapshot notices / modal state
  const snapshot = await cdp2.evaluate(`({
    phase: window.__voAuto,
    noticeCount: document.querySelectorAll(".notice").length,
    modalOpen: !!document.querySelector(".modal-container"),
    modalText: (document.querySelector(".modal-container")?.innerText || "").slice(0, 2000),
    statusBar: (document.querySelector(".status-bar")?.innerText || "").slice(0, 500),
    fileCount: app.vault.getMarkdownFiles().length,
  })`);
  console.log("Snapshot:", JSON.stringify(snapshot, null, 2));

  const report = [
    "# Obsidian CDP automation log",
    `time: ${new Date().toISOString()}`,
    `target: ${target2.title}`,
    `rebuild: ${rebuildPhase}`,
    `organize: ${orgPhase}`,
    `snapshot: ${JSON.stringify(snapshot)}`,
    "",
    "## Console",
    ...cdp2.consoleLines,
  ].join("\n");
  writeFileSync(OUT, report, "utf8");
  console.log("Wrote", OUT);

  if (orgPhase === "organize:error") {
    process.exitCode = 1;
  }
  cdp2.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
