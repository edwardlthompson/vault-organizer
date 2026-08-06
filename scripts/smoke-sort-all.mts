/**
 * Smoke: index + suggest for all vault notes (dry-run by default).
 * Usage:
 *   node --import tsx scripts/smoke-sort-all.mts
 *   node --import tsx scripts/smoke-sort-all.mts --vault "C:/Users/edwar/Documents/My Notes"
 *   node --import tsx scripts/smoke-sort-all.mts --apply   # writes frontmatter + moves (destructive)
 *   node --import tsx scripts/smoke-sort-all.mts --limit 50
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHashEmbedder, createProductionEmbedder } from "../plugin/src/embedder.ts";
import { probeHardware } from "../plugin/src/hardware.ts";
import { buildVaultIndex, suggestForNote } from "../plugin/src/sorter.ts";
import { applySuggestion, isProcessed } from "../plugin/src/apply.ts";
import { DEFAULT_SETTINGS } from "../plugin/src/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}
function has(flag: string): boolean {
  return process.argv.includes(flag);
}

const vault = arg("--vault", path.join(process.env.USERPROFILE ?? "", "Documents", "My Notes"))!;
const limit = Number(arg("--limit", "0") || "0");
const doApply = has("--apply");
const useOnnx = has("--onnx");
const logPath =
  arg("--log") ??
  path.join(root, "dist", `smoke-sort-all-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);

fs.mkdirSync(path.dirname(logPath), { recursive: true });
const logStream = fs.createWriteStream(logPath, { flags: "w" });
function log(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  logStream.write(stamped + "\n");
}

function walkMd(dir: string, base = dir): { abs: string; rel: string }[] {
  const out: { abs: string; rel: string }[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".obsidian" || ent.name.startsWith(".")) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkMd(abs, base));
    else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
      out.push({ abs, rel: path.relative(base, abs).split(path.sep).join("/") });
    }
  }
  return out;
}

function parseTags(content: string): string[] {
  const tags = new Set<string>();
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const tagBlock = fm[1].match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
    if (tagBlock) {
      for (const line of tagBlock[1].split(/\r?\n/)) {
        const m = line.match(/^\s*-\s*(.+)/);
        if (m) tags.add(m[1].trim().startsWith("#") ? m[1].trim() : `#${m[1].trim()}`);
      }
    }
  }
  for (const m of content.matchAll(/(^|\s)#([A-Za-z0-9/_-]+)/g)) {
    tags.add(`#${m[2]}`);
  }
  return [...tags];
}

async function main(): Promise<void> {
  const t0 = Date.now();
  log(`SMOKE sort-all start`);
  log(`vault=${vault}`);
  log(`apply=${doApply} limit=${limit || "none"} onnx=${useOnnx}`);

  if (!fs.existsSync(vault)) {
    log(`ERROR vault missing`);
    process.exit(1);
  }

  let files = walkMd(vault);
  log(`found ${files.length} markdown files`);
  if (limit > 0) files = files.slice(0, limit);

  const settings = {
    ...DEFAULT_SETTINGS,
    applyMode: "suggest" as const,
    confidenceThreshold: 0.2,
  };

  const notes = files.map(({ abs, rel }) => {
    const content = fs.readFileSync(abs, "utf8");
    const folder = path.posix.dirname(rel);
    return {
      path: rel,
      abs,
      folder: folder === "." ? "" : folder,
      content,
      tags: parseTags(content),
      filename: path.basename(rel),
    };
  });

  let embed = createHashEmbedder();
  if (useOnnx) {
    const modelDir = path.join(
      vault,
      ".obsidian",
      "plugins",
      "vault-organizer",
      "models",
      "arctic-embed-m"
    );
    log(`loading ONNX from ${modelDir}`);
    const hw = probeHardware({ batchMode: "manual", manualBatchSize: 2 });
    const produced = await createProductionEmbedder({
      modelDir,
      hardware: { ...hw, webgpu: false },
    });
    log(`embedder status: mode=${produced.status.mode} msg=${produced.status.message}`);
    if (produced.status.mode === "missing") {
      log(`ERROR model missing — abort ONNX smoke`);
      process.exit(2);
    }
    embed = produced.embed;
  } else {
    log(`embedder=hash (deterministic offline smoke)`);
  }
  log(`building index for ${notes.length} notes…`);
  const index = await buildVaultIndex(
    embed,
    notes.map((n) => ({
      path: n.path,
      folder: n.folder,
      content: n.content,
      tags: n.tags,
    })),
    settings
  );
  log(
    `index ready: folders=${index.folderCentroids.length} tags=${index.tagPrototypes.length} vectors=${index.noteVectors.size}`
  );
  for (const c of index.folderCentroids.slice(0, 30)) {
    log(`  centroid folder="${c.folder}" count=${c.count}`);
  }

  let suggested = 0;
  let skippedProcessed = 0;
  let applied = 0;
  let lowConf = 0;
  const moves: string[] = [];

  for (const n of notes) {
    if (isProcessed(n.content, settings.processedFrontmatterKey)) {
      skippedProcessed++;
      continue;
    }
    const suggestion = await suggestForNote(
      embed,
      index,
      { path: n.path, filename: n.filename, content: n.content },
      settings
    );
    suggested++;
    const top = suggestion.folders[0];
    const tags = suggestion.tags.map((t) => t.tag).join(" ");
    const line = `${n.path} -> folder=${top?.folder ?? "(none)"} score=${(top?.score ?? 0).toFixed(3)} conf=${suggestion.confidence.toFixed(3)} tags=[${tags}] title=${suggestion.titles[0]?.title ?? ""}`;
    if (suggestion.confidence < settings.confidenceThreshold) {
      lowConf++;
      log(`LOW  ${line}`);
    } else {
      log(`OK   ${line}`);
    }

    if (doApply && top && suggestion.confidence >= settings.confidenceThreshold) {
      const record = await applySuggestion(suggestion, settings, {
        read: async (p) => {
          const abs = path.join(vault, p);
          return fs.readFileSync(abs, "utf8");
        },
        write: async (p, c) => {
          const abs = path.join(vault, p);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, c, "utf8");
        },
        ensureFolder: async (folder) => {
          fs.mkdirSync(path.join(vault, folder), { recursive: true });
        },
        rename: async (from, to) => {
          const a = path.join(vault, from);
          const b = path.join(vault, to);
          fs.mkdirSync(path.dirname(b), { recursive: true });
          fs.renameSync(a, b);
          return to;
        },
      });
      applied++;
      moves.push(`${record.fromPath} => ${record.toPath}`);
      log(`APPLY ${record.fromPath} => ${record.toPath}`);
    }
  }

  const ms = Date.now() - t0;
  log(`--- summary ---`);
  log(`notes=${notes.length} suggested=${suggested} lowConf=${lowConf} skippedProcessed=${skippedProcessed} applied=${applied}`);
  log(`elapsedMs=${ms}`);
  log(`logFile=${logPath}`);
  if (moves.length) {
    log(`moves:`);
    for (const m of moves.slice(0, 100)) log(`  ${m}`);
  }
  logStream.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
