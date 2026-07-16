import type { Ports, VersionInfo } from "../types";

export const VERSION_COLORS: Record<string, string> = {
  "16": "text-blue-500 border-blue-500/30",
  "17": "text-green-500 border-green-500/30",
  "18": "text-purple-500 border-purple-500/30",
  "19": "text-orange-500 border-orange-500/30",
};

export const VERSION_BG: Record<string, string> = {
  "16": "bg-blue-500/10",
  "17": "bg-green-500/10",
  "18": "bg-purple-500/10",
  "19": "bg-orange-500/10",
};

// Deterministic fallback so future versions (v20, ...) render styled without
// a GUI release — same palette, cycled by version number.
const COLOR_CYCLE = Object.values(VERSION_COLORS);
const BG_CYCLE = Object.values(VERSION_BG);

function cycleIndex(version: string, length: number): number {
  const n = Number.parseInt(version, 10);
  return (Number.isNaN(n) ? 0 : n) % length;
}

export function versionColor(version: string): string {
  return VERSION_COLORS[version] ?? COLOR_CYCLE[cycleIndex(version, COLOR_CYCLE.length)];
}

export function versionBg(version: string): string {
  return VERSION_BG[version] ?? BG_CYCLE[cycleIndex(version, BG_CYCLE.length)];
}

/** Runtime ports of a version: .env-resolved (CLI >= 0.58.0, per-user port
 *  prefixes on multi-user hosts) with registry-default fallback. */
export function effectivePorts(info: VersionInfo): Ports {
  return info.effective_ports ?? info.ports;
}

export const POLL_INTERVALS = {
  docker: 5_000,
  venv: 30_000,
  server: 1_000,
};

export const LOG_BUFFER_CAP = 50_000;
export const DOCKER_LOG_BUFFER_CAP = 10_000;
