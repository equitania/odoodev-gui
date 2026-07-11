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
  runtime: ContainerRuntime;
}

export interface ContainerInfo {
  id: string;
  image: string;
  os: string;
  arch: string;
  state: string;
  ip: string;
  cpus: number;
  memory_mb: number;
  started: string;
  host_port: number;
}

export interface RuntimeInfo {
  runtime: ContainerRuntime;
  configured: string | null;
  available: string[];
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

export interface EnvCheckResult {
  exists: boolean;
  complete: boolean;
  message: string;
}

export interface MigrationGroup {
  name: string;
  from_version: string;
  to_version: string;
  postgres: string;
  shared_port: number;
  status: string;
}

export interface MigrationStatus {
  active: boolean;
  no_active: boolean;
  group_name: string | null;
  source: string | null;
  target: string | null;
  shared_port: number | null;
  filestore: string | null;
}

export interface DoctorCheck {
  name: string;
  status: string;
  message: string;
}

export interface DoctorResult {
  version: string | null;
  checks: DoctorCheck[];
  overall: string;
  all_ok: boolean;
  raw_output: string;
}

export interface PlaybookEvent {
  event: string;
  name?: string;
  command?: string;
  status?: string;
  message?: string;
  exit_code?: number;
  duration_ms?: number;
  details?: Record<string, unknown>;
  playbook?: string;
  version?: string;
  dry_run?: boolean;
  steps_ok?: number;
  steps_error?: number;
  total_duration_ms?: number;
}

export interface PlaybookInfo {
  name: string;
  path: string;
  description?: string;
  version?: string;
  steps?: string[];
  vars?: Record<string, unknown>;
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

export type ViewKey = "dashboard" | "server" | "database" | "docker" | "venv" | "repos" | "env" | "playbook" | "init" | "migrate" | "doctor" | "settings";

export type ContainerRuntime = "docker" | "apple" | "none";