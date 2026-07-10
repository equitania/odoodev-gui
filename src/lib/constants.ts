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

export const POLL_INTERVALS = {
  docker: 5_000,
  venv: 30_000,
  server: 1_000,
};

export const LOG_BUFFER_CAP = 50_000;