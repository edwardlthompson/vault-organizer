import type { HardwareProfile, VaultOrganizerSettings } from "./types";

export function probeHardware(
  settings: Pick<VaultOrganizerSettings, "batchMode" | "manualBatchSize">
): HardwareProfile {
  const cores =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }) : null;
  const deviceMemoryGb = nav?.deviceMemory ?? null;
  const webgpu = typeof navigator !== "undefined" && !!(navigator as Navigator & { gpu?: unknown }).gpu;

  if (settings.batchMode === "manual") {
    return {
      cores,
      deviceMemoryGb,
      webgpu,
      batchSize: Math.max(1, settings.manualBatchSize),
      label: "manual",
    };
  }

  let batchSize = 2;
  if (cores >= 12 && (deviceMemoryGb === null || deviceMemoryGb >= 8)) batchSize = webgpu ? 8 : 6;
  else if (cores >= 8) batchSize = webgpu ? 6 : 4;
  else if (cores >= 4) batchSize = webgpu ? 4 : 2;
  else batchSize = 1;

  if (deviceMemoryGb !== null && deviceMemoryGb <= 4) batchSize = Math.min(batchSize, 2);

  const label = webgpu ? `auto-webgpu-x${batchSize}` : `auto-wasm-x${batchSize}`;
  return { cores, deviceMemoryGb, webgpu, batchSize, label };
}
