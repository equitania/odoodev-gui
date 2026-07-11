import { invokeCmd } from "../lib/tauri";
import type {
  BackupArgs,
  BackupResult,
  ContainerInfo,
  DashboardStatus,
  DbListResponse,
  DockerStatus,
  EnvCheckResult,
  OdooLogEntry,
  OdoodevInfoDto,
  OpResult,
  PlatformInfo,
  PlaybookInfo,
  RestoreArgs,
  RestoreResult,
  RuntimeInfo,
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
    listContainers: () => invokeCmd<ContainerInfo[]>("list_containers"),
    getRuntimeInfo: () => invokeCmd<RuntimeInfo>("get_runtime_info"),
    dockerLogs: (version: string, runtime?: string, tail?: number) =>
      invokeCmd<OpResult>("docker_logs", { version, runtime, tail }),
    dockerBench: (version: string, runtime?: string, duration?: number, scale?: number) =>
      invokeCmd<OpResult>("docker_bench", { version, runtime, duration, scale }),
    getRuntime: () => invokeCmd<string>("get_runtime"),
    getRuntimeConfig: () => invokeCmd<string | null>("get_runtime_config"),
    venvSetup: (version: string, force: boolean) =>
      invokeCmd<OpResult>("venv_setup", { version, force }),
    venvRemove: (version: string) => invokeCmd<OpResult>("venv_remove", { version }),
    reposRun: (version: string, configOnly: boolean) =>
      invokeCmd<OpResult>("repos_run", { version, config_only: configOnly }),
    reposPull: (version: string, noConfig: boolean) =>
      invokeCmd<OpResult>("repos_pull", { version, no_config: noConfig }),
    envCheck: (version: string) => invokeCmd<EnvCheckResult>("env_check", { version }),
    envDir: (version: string) => invokeCmd<string>("env_dir", { version }),
    envShow: (version: string) => invokeCmd<string>("env_show", { version }),
    envSetup: (version: string) => invokeCmd<OpResult>("env_setup", { version }),
    playbookList: () => invokeCmd<PlaybookInfo[]>("playbook_list"),
    playbookValidSteps: () => invokeCmd<string[]>("playbook_valid_steps"),
    playbookRun: (
      playbook: string | null,
      steps: string[],
      version: string | null,
      vars: string[],
      dryRun: boolean,
    ) =>
      invokeCmd<OpResult>("playbook_run", { playbook, steps, version, vars, dry_run: dryRun }),
    initVersion: (version: string, skipRepos: boolean, skipDocker: boolean) =>
      invokeCmd<OpResult>("init_version", { version, skip_repos: skipRepos, skip_docker: skipDocker }),
    setupConfig: (reset: boolean) =>
      invokeCmd<OpResult>("setup_config", { reset }),
  };
}