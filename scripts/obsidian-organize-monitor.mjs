/**
 * Run Vault Organizer on My Notes and capture Obsidian console (logcat-style).
 * Actions: reload → rebuild-index → organize-uncategorized
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEBUG = process.env.OBSIDIAN_CDP || "http://127.0.0.1:9222";
const PLUGIN = join(
  process.env.USERPROFILE || "",
  "Documents",
  "My Notes",
  ".obsidian",
  "plugins",
  "vault-organizer"
);
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const LOG_PATH = join(OUT_DIR, "organize-logcat.log");
const SUMMARY_PATH = join(OUT_DIR, "organize-run-summary.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageTarget(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const targets = await (await fetch(`${DEBUG}/json/list`)).json();
      const page = targets.find(
        (t) => t.type === "page" && t.webSocketDebuggerUrl && (t.title || "").includes("Obsidian")
      );
      if (page) return page;
    } catch {
      /* retry */
    }
    await sleep(1000);
  }
  throw new Error("No Obsidian CDP page target");
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.lines = [];
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", rej, { once: true });
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
      if (msg.method === "Runtime.consoleAPICalled") {
        const type = msg.params?.type || "log";
        const args = (msg.params?.args || [])
          .map((a) => a.value ?? a.description ?? a.type)
          .join(" ");
        this.push(type, args);
      } else if (msg.method === "Log.entryAdded") {
        const e = msg.params?.entry || {};
        this.push(`log:${e.level || "info"}`, e.text || "");
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params?.exceptionDetails;
        this.push(
          "exception",
          d?.exception?.description || d?.text || JSON.stringify(d)
        );
      }
    });
  }

  push(level, text) {
    const line = `${new Date().toISOString()} [${level}] ${text}`;
    this.lines.push(line);
    const interesting =
      /vault organizer|onnx|error|warn|exception|fail|progress|embed|organiz|index/i.test(
        text
      );
    if (interesting || level === "error" || level === "exception" || level === "warning") {
      console.log(line);
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 120000);
    });
  }

  async evaluate(expression, awaitPromise = false) {
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

function readLastRun() {
  const p = join(PLUGIN, "last-run.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeRequest(actions) {
  const req = join(PLUGIN, "run-request.json");
  const last = join(PLUGIN, "last-run.json");
  if (existsSync(last)) unlinkSync(last);
  writeFileSync(req, JSON.stringify({ actions, ts: new Date().toISOString() }), "utf8");
  console.log("Wrote run-request:", actions.join(", "));
}

function analyze(lines, lastRun) {
  const errors = lines.filter((l) => /\[(error|exception|log:error)\]/i.test(l));
  const warnings = lines.filter((l) => /\[(warning|log:warning|warn)\]/i.test(l));
  const vo = lines.filter((l) => /vault organizer|onnx|embed|organiz|index/i.test(l));
  const opts = [];
  if (warnings.some((w) => /hash-fallback/i.test(w))) {
    opts.push("ONNX fell back to hash — check wasm pack / model load");
  }
  if (errors.some((e) => /worker_threads/i.test(e))) {
    opts.push("ORT still hitting worker_threads path — re-vendor patched jsep");
  }
  if (errors.some((e) => /Failed to fetch|file:\/\//i.test(e))) {
    opts.push("Local file fetch blocked — fs-fetch shim may not be active");
  }
  if (vo.filter((l) => /embed \d+\//i.test(l)).length === 0 && lastRun?.event === "request-complete") {
    opts.push("Little embed progress logged — progress modal may be primary UI signal");
  }
  if (lastRun?.embedStatus?.mode === "onnx") {
    opts.push("ONNX wasm path healthy");
  }
  return {
    errorCount: errors.length,
    warningCount: warnings.length,
    errors: errors.slice(-40),
    warnings: warnings.slice(-40),
    vaultOrganizerLines: vo.slice(-60),
    optimizations: opts,
    lastRun,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log("Connecting CDP…");
  let page = await getPageTarget();
  let cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  try {
    await cdp.send("Console.enable");
  } catch {
    /* optional */
  }

  console.log("Reloading Obsidian to pick up plugin…");
  try {
    await cdp.evaluate(`app.commands.executeCommandById("app:reload")`);
  } catch (e) {
    console.log("reload command failed:", e.message);
  }
  cdp.close();
  await sleep(12000);

  page = await getPageTarget();
  cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");

  // Wait for plugin
  const startWait = Date.now();
  while (Date.now() - startWait < 90000) {
    const ok = await cdp
      .evaluate(`!!(app.plugins?.plugins?.["vault-organizer"])`)
      .catch(() => false);
    if (ok) break;
    await sleep(2000);
  }
  const status = await cdp
    .evaluate(`JSON.stringify(app.plugins.plugins["vault-organizer"]?.embedStatus || null)`)
    .catch(() => null);
  console.log("Embed status:", status);

  // Prefer command if available; also drop file request as backup
  writeRequest(["organize-uncategorized"]);

  // Try command palette path via executeCommandById after short delay
  await sleep(3000);
  try {
    const hasCmd = await cdp.evaluate(
      `!!app.commands.findCommand("vault-organizer:organize-uncategorized")`
    );
    console.log("organize-uncategorized command present:", hasCmd);
  } catch (e) {
    console.log("command check failed:", e.message);
  }

  console.log("Monitoring last-run.json + console…");
  const deadline = Date.now() + 45 * 60 * 1000;
  let lastEvent = "";
  while (Date.now() < deadline) {
    const lr = readLastRun();
    if (lr && lr.event !== lastEvent) {
      lastEvent = lr.event;
      console.log("last-run:", lr.event, lr.statusBar || "", lr.embedStatus?.message || "");
      cdp.push("info", `last-run event=${lr.event} status=${lr.statusBar}`);
    }
    if (lr && (lr.event === "request-complete" || lr.event === "request-error" || lr.event === "organize-finished")) {
      // allow a moment for trailing console
      await sleep(2000);
      break;
    }
    // also peek status bar via CDP
    try {
      const bar = await cdp.evaluate(
        `(document.querySelector(".status-bar")?.innerText || "").slice(0, 240)`
      );
      if (bar && /Vault Organizer/i.test(bar)) {
        const mark = `status-bar: ${bar}`;
        if (!cdp.lines.some((l) => l.endsWith(mark))) cdp.push("info", mark);
      }
    } catch {
      /* CDP blip */
    }
    await sleep(4000);
  }

  const lastRun = readLastRun();
  const summary = analyze(cdp.lines, lastRun);
  writeFileSync(LOG_PATH, cdp.lines.join("\n"), "utf8");
  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2), "utf8");
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("Wrote", LOG_PATH);
  console.log("Wrote", SUMMARY_PATH);
  cdp.close();
  if (summary.errorCount > 0 || lastRun?.event === "request-error") process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
