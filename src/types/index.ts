export interface Ports {
  db: number;
  odoo: number;
  gevent: number;
  mailpit: number;
}

export interface VersionInfo {
  python: string;
  postgres: string;
  ports: Ports;
  base: string;
}

export type VersionsResponse = Record<string, VersionInfo>;

export interface VenvStatus {
  version: string;
  venv_dir: string;
  exists: boolean;
  is_symlink: boolean;
  python_version: string | null;
  python_matches: boolean | null;
  requirements_current: boolean | null;
}

export interface DbListResponse {
  version: string;
  host: string;
  port: number;
  databases: string[];
}

export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL" | "RAW";

export interface OdooLogEntry {
  timestamp: string;
  pid: string;
  level: LogLevel;
  database: string;
  logger: string;
  message: string;
  raw: string;
}

export interface DockerStatus {
  running: boolean;
  container_name: string;
  runtime: string;
}

export interface ServerStatus {
  running: boolean;
  pid: number | null;
  uptime_seconds: number | null;
  port: number | null;
}

export interface UvInfoDto {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export interface OdoodevInfoDto {
  installed: boolean;
  version: string | null;
}

export interface UpdateCheckResult {
  installed_version: string | null;
  latest_version: string | null;
  update_available: boolean;
}

export interface PlatformInfo {
  os: string;
  arch: string;
}

export interface BackupResult {
  success: boolean;
  path: string | null;
  size: string | null;
  error: string | null;
}

export interface RestoreResult {
  success: boolean;
  error: string | null;
}

export interface OpResult {
  success: boolean;
  error: string | null;
}

export interface DashboardStatus {
  versions: VersionsResponse;
  active_versions: string[];
  venv_status: Record<string, VenvStatus>;
  docker_status: Record<string, DockerStatus>;
  server_status: Record<string, ServerStatus>;
}

export interface StartServerArgs {
  version: string;
  mode?: string;
  database?: string;
  update_modules?: string;
  install_modules?: string;
  host?: string;
  load_language?: string;
  i18n_overwrite?: boolean;
  clean_sessions?: boolean;
  config_path?: string;
  allow_default_credentials?: boolean;
  runtime?: string;
  extra_args?: string;
}

export interface StartResult {
  pid: number;
  port: number;
}

export interface BackupArgs {
  version: string;
  name: string;
  type: string;
  output_dir?: string;
  level?: number;
}

export interface RestoreArgs {
  version: string;
  name: string;
  backup_file: string;
  drop?: boolean;
  deactivate_cron?: boolean;
  neutralize?: boolean;
  anonymize?: boolean;
  wipe?: boolean;
  purge_master_data?: boolean;
  no_purge_master_data?: boolean;
  purge_transactions?: boolean;
  anonymize_users?: boolean;
  user_password?: string;
  uninstall_modules?: string;
  recompute?: boolean;
  keep_temp?: boolean;
  check_space?: boolean;
  delete_backup?: boolean;
  dry_run?: boolean;
}

export interface ServerState {
  status: ServerStatus | null;
  logBuffer: OdooLogEntry[];
  config: StartServerArgs | null;
}

export type ViewKey = "dashboard" | "server" | "database" | "settings";