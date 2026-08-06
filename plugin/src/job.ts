/** Shared cancellation / exclusive-job helpers for long ONNX work. */

export class JobCancelledError extends Error {
  constructor(message = "Vault Organizer job cancelled") {
    super(message);
    this.name = "JobCancelledError";
  }
}

/** Yield to the UI / Obsidian event loop between heavy WASM steps. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Format seconds as m:ss or h:mm:ss. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
