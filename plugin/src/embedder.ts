import * as fs from "fs";
import * as path from "path";
import { absolutePathExists, normalizeFsPath } from "./fs-exists";
import type { HardwareProfile } from "./types";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/**
 * Obsidian runs as Electron with an app:// origin, so Transformers.js cannot
 * fetch vendored weights via file://. Route local model reads through Node fs.
 * Also expose vendored ORT WASM/JS as blob: URLs (dynamic import() cannot use file://).
 */
function installLocalFsFetch(): () => void {
  const original = globalThis.fetch.bind(globalThis);

  const toFsPath = (urlOrPath: string): string | null => {
    if (!urlOrPath || /^https?:\/\//i.test(urlOrPath) || urlOrPath.startsWith("blob:")) {
      return null;
    }
    let p = urlOrPath;
    if (p.startsWith("file:")) {
      try {
        p = decodeURIComponent(new URL(p).pathname);
      } catch {
        p = decodeURIComponent(p.replace(/^file:\/\/\//i, "").replace(/^file:\/\//i, ""));
      }
      // URL pathname on Windows is "/C:/..."
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    }
    // Transformers may pass POSIX-looking absolute paths
    p = p.replace(/\//g, path.sep);
    return p;
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const filePath = toFsPath(raw);
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const buf = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const type =
        ext === ".json"
          ? "application/json"
          : ext === ".txt"
            ? "text/plain"
            : ext === ".mjs" || ext === ".js"
              ? "text/javascript"
              : "application/octet-stream";
      return new Response(buf, {
        status: 200,
        statusText: "OK",
        headers: {
          "Content-Type": type,
          "Content-Length": String(buf.byteLength),
        },
      });
    }
    return original(input as RequestInfo, init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

/** Build ort.env.wasm.wasmPaths as { mjs, wasm } blob URLs (ORT 1.22+ shape). */
function wasmBlobPaths(wasmDir: string): { mjs: string; wasm: string } {
  const readBlob = (name: string, type: string): string => {
    const full = path.join(wasmDir, name);
    if (!fs.existsSync(full)) {
      throw new Error(`Missing ORT asset: ${full}`);
    }
    const buf = fs.readFileSync(full);
    return URL.createObjectURL(new Blob([buf], { type }));
  };
  // Prefer non-jsep assets when present (fewer Electron Node-detection footguns).
  // Fall back to jsep (ORT 1.22 default) which we patch in scripts/vendor-ort-wasm.ps1.
  const mjsName = fs.existsSync(path.join(wasmDir, "ort-wasm-simd-threaded.mjs"))
    ? "ort-wasm-simd-threaded.mjs"
    : "ort-wasm-simd-threaded.jsep.mjs";
  const wasmName = fs.existsSync(path.join(wasmDir, "ort-wasm-simd-threaded.wasm"))
    ? "ort-wasm-simd-threaded.wasm"
    : "ort-wasm-simd-threaded.jsep.wasm";
  return {
    mjs: readBlob(mjsName, "text/javascript"),
    wasm: readBlob(wasmName, "application/wasm"),
  };
}

/**
 * Hashing embedder for tests / CI when ONNX weights are absent.
 * Produces stable 64-d pseudo-embeddings from token hashes (not for production quality).
 */
export function createHashEmbedder(dims = 64): EmbedFn {
  return async (texts: string[]) =>
    texts.map((text) => {
      const v = new Array(dims).fill(0);
      const tokens = text.toLowerCase().split(/[^a-z0-9#/]+/).filter(Boolean);
      for (const tok of tokens) {
        let h = 2166136261;
        for (let i = 0; i < tok.length; i++) {
          h ^= tok.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        v[Math.abs(h) % dims] += 1;
        v[Math.abs(h >> 8) % dims] += 0.5;
      }
      let n = 0;
      for (const x of v) n += x * x;
      n = Math.sqrt(n) || 1;
      return v.map((x) => x / n);
    });
}

export interface EmbedderStatus {
  ready: boolean;
  mode: "onnx" | "hash-fallback" | "missing";
  message: string;
  modelDir: string;
}

/**
 * Resolve model directory relative to the plugin folder.
 * In Obsidian, `adapter.basePath` + plugin id is used by caller.
 */
export function modelRelativePath(packId: string): string {
  return `models/${packId}`;
}

export async function createProductionEmbedder(opts: {
  modelDir: string;
  hardware: HardwareProfile;
  /** Injected for tests */
  pipelineFactory?: () => Promise<EmbedFn>;
  /** Optional override; defaults to Node fs absolute-path check */
  fileExists?: (path: string) => Promise<boolean> | boolean;
}): Promise<{ embed: EmbedFn; status: EmbedderStatus }> {
  const modelDir = normalizeFsPath(opts.modelDir);
  const check = async (p: string): Promise<boolean> => {
    if (opts.fileExists) return Boolean(await opts.fileExists(p));
    return absolutePathExists(p);
  };

  const hasModel =
    (await check(`${modelDir}/onnx/model_quantized.onnx`)) ||
    (await check(`${modelDir}/onnx/model_int8.onnx`)) ||
    (await check(`${modelDir}/config.json`));

  if (!hasModel) {
    return {
      embed: createHashEmbedder(),
      status: {
        ready: false,
        mode: "missing",
        message:
          "Model pack not found. Install vault-organizer-full.zip or copy models into the plugin folder.",
        modelDir,
      },
    };
  }

  if (opts.pipelineFactory) {
    const embed = await opts.pipelineFactory();
    return {
      embed,
      status: {
        ready: true,
        mode: "onnx",
        message: "Using injected embedder",
        modelDir,
      },
    };
  }

  const restoreFetch = installLocalFsFetch();
  // Obsidian's Electron sets process.release.name === "node", so Transformers.js
  // selects the Node ORT path (empty in the renderer) and never registers
  // wasm/webgpu devices. Spoof a non-node release while importing transformers.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("onnxruntime")];
  // ORT's jsep WASM glue treats missing process.type as Node and imports worker_threads.
  const proc = process as NodeJS.Process & { type?: string };
  if (proc.type == null) proc.type = "renderer";
  const prevRelease = Object.getOwnPropertyDescriptor(process, "release");
  Object.defineProperty(process, "release", {
    configurable: true,
    enumerable: true,
    get: () => ({ name: "browser" }),
  });
  try {
    const pluginRoot = path.dirname(path.dirname(modelDir));
    const wasmDir = path.join(pluginRoot, "wasm");
    const wasmPaths = absolutePathExists(wasmDir) ? wasmBlobPaths(wasmDir) : null;

    // Configure ORT before Transformers.js initializes backends.
    const ortMod = await import("onnxruntime-web");
    const ort = (ortMod as { default?: { env?: { wasm?: Record<string, unknown> } }; env?: { wasm?: Record<string, unknown> } })
      .default ?? ortMod;
    if (ort.env?.wasm) {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      if (wasmPaths) ort.env.wasm.wasmPaths = wasmPaths;
      console.info(
        `[Vault Organizer] ORT wasmPaths mjs=${Boolean(wasmPaths?.mjs)} wasm=${Boolean(wasmPaths?.wasm)}`
      );
    }

    // Dynamic import keeps Vitest/CI light when transformers isn't exercised.
    const transformers = await import("@huggingface/transformers");
    // Load only from the vendored directory — never Hugging Face Hub.
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = false;
    transformers.env.useBrowserCache = false;
    // Web build stubs Node fs; keep useFS false and serve files via fetch shim above.
    transformers.env.useFS = false;
    const env = transformers.env as typeof transformers.env & {
      remoteModels?: boolean;
    };
    env.remoteModels = false;

    const onnxBackend = transformers.env.backends?.onnx as
      | {
          wasm?: {
            numThreads?: number;
            proxy?: boolean;
            wasmPaths?: string | { mjs?: string; wasm?: string };
          };
        }
      | undefined;
    if (onnxBackend?.wasm) {
      onnxBackend.wasm.numThreads = 1;
      onnxBackend.wasm.proxy = false;
      if (wasmPaths) onnxBackend.wasm.wasmPaths = wasmPaths;
    }

    // wasm first — webgpu's jsep proxy is more fragile under Obsidian's CSP
    const deviceCandidates = ["wasm", "webgpu"] as const;

    let extractor: ((text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array | number[] }>) | null =
      null;
    let deviceUsed = "wasm";
    let lastErr: unknown;
    for (const device of deviceCandidates) {
      try {
        // Cast avoids TS2590 on transformers.js pipeline overloads
        const pipe = (await (transformers.pipeline as Function)(
          "feature-extraction",
          modelDir,
          {
            local_files_only: true,
            device,
            dtype: "q8",
          }
        )) as (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array | number[] }>;
        extractor = pipe;
        deviceUsed = device;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!extractor) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));

    const embed: EmbedFn = async (texts) => {
      const out: number[][] = [];
      for (const text of texts) {
        const result = await extractor!(text, {
          pooling: "cls",
          normalize: true,
        });
        out.push(Array.from(result.data));
        // Yield after each inference so Obsidian FS / UI / cancel can run.
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      return out;
    };

    // Leave fs-fetch shim installed — embeddings may re-read assets.
    console.info(`[Vault Organizer] ONNX ready (${deviceUsed}) from ${modelDir}`);
    return {
      embed,
      status: {
        ready: true,
        mode: "onnx",
        message: `ONNX ready (${deviceUsed})`,
        modelDir,
      },
    };
  } catch (err) {
    restoreFetch();
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Vault Organizer] ONNX load failed: ${msg}`);
    return {
      embed: createHashEmbedder(),
      status: {
        ready: true,
        mode: "hash-fallback",
        message: `ONNX load failed (${msg}). Using hash fallback for degraded sorting.`,
        modelDir,
      },
    };
  } finally {
    if (prevRelease) Object.defineProperty(process, "release", prevRelease);
    else delete (process as { release?: unknown }).release;
  }
}
