import { invokeCmd } from "../lib/tauri";
import type {
  BackupArgs,
  BackupResult,
  DashboardStatus,
  DbListResponse,
  DockerStatus,
  OdooLogEntry,
  OdoodevInfoDto,
  OpResult,
  PlatformInfo,
  RestoreArgs,
  RestoreResult,
  ServerStatus,
  StartServerArgs,
  UpdateCheckResult,
  UvInfoDto,
  VersionsResponse,
  VenvStatus,
} from "../types";

export function useOdoodev() {
  return {
    getVersions: () => invokeCmd<VersionsResponse>("get_versions"),
    getVenvStatus: (version: string) => invokeCmd<VenvStatus>("get_venv_status", { version }),
    getActiveVersions: () => invokeCmd<string[]>("get_active_versions"),
    getDockerStatus: (version: string, versions: VersionsResponse) =>
      invokeCmd<DockerStatus>("get_docker_status", { version, versions }),
    getServerStatus: (version: string) => invokeCmd<ServerStatus>("get_server_status", { version }),
    getAllServerStatuses: () => invokeCmd<Record<string, ServerStatus>>("get_all_server_statuses"),
    getAllDashboardStatus: () => invokeCmd<DashboardStatus>("get_all_dashboard_status"),
    getOdooLogEntry: (line: string) => invokeCmd<OdooLogEntry>("get_odoo_log_entry", { line }),
    getPypiVersion: () => invokeCmd<string | null>("get_pypi_version"),
    checkOdoodevUpdate: () => invokeCmd<UpdateCheckResult>("check_odoodev_update"),
    upgradeOdoodev: () => invokeCmd<OdoodevInfoDto>("upgrade_odoodev"),
    getAppVersion: () => invokeCmd<string>("get_app_version"),
    checkUvStatus: () => invokeCmd<UvInfoDto>("check_uv_status_cmd"),
    getPlatformInfo: () => invokeCmd<PlatformInfo>("get_platform_info"),
    openExternal: (url: string) => invokeCmd("open_external", { url }),
    checkUv: () => invokeCmd<UvInfoDto>("check_uv"),
    installUv: () => invokeCmd<UvInfoDto>("install_uv"),
    checkOdoodev: () => invokeCmd<OdoodevInfoDto>("check_odoodev"),
    installOdoodev: () => invokeCmd<OdoodevInfoDto>("install_odoodev"),
    startServer: (args: StartServerArgs) => invokeCmd<{ pid: number; port: number }>("start_server", { args }),
    stopServer: (version: string, keepDocker: boolean = true, force: boolean = false) =>
      invokeCmd<OpResult>("stop_server", { version, keepDocker, force }),
    getDatabases: (version: string) => invokeCmd<DbListResponse>("get_databases", { version }),
    backupDb: (args: BackupArgs) => invokeCmd<BackupResult>("backup_db", { args }),
    restoreDb: (args: RestoreArgs) => invokeCmd<RestoreResult>("restore_db", { args }),
    dropDb: (version: string, name: string, terminateConnections: boolean = true) =>
      invokeCmd<OpResult>("drop_db", { version, name, terminateConnections }),
    copyDb: (version: string, src: string, dst: string, terminateConnections: boolean = true) =>
      invokeCmd<OpResult>("copy_db", { version, src, dst, terminateConnections }),
    renameDb: (version: string, src: string, dst: string, terminateConnections: boolean = true) =>
      invokeCmd<OpResult>("rename_db", { version, src, dst, terminateConnections }),
    dockerUp: (version: string, runtime?: string) => invokeCmd<OpResult>("docker_up", { version, runtime }),
    dockerDown: (version: string, runtime?: string) => invokeCmd<OpResult>("docker_down", { version, runtime }),
    dockerStatus: (version: string, versions: VersionsResponse) =>
      invokeCmd<DockerStatus>("docker_status", { version, versions }),
    getRuntime: () => invokeCmd<string>("get_runtime"),
    getRuntimeConfig: () => invokeCmd<string | null>("get_runtime_config"),
  };
}