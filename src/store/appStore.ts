import { create } from "zustand";
import type {
  DashboardStatus,
  OdooLogEntry,
  ServerState,
  ServerStatus,
  StartServerArgs,
  UvInfoDto,
  OdoodevInfoDto,
  UpdateCheckResult,
  VersionsResponse,
} from "../types";
import { invokeCmd } from "../lib/tauri";
import { LOG_BUFFER_CAP } from "../lib/constants";

interface AppState {
  odoodevVersion: string | null;
  pypiVersion: string | null;
  uvInfo: UvInfoDto | null;
  odoodevInfo: OdoodevInfoDto | null;
  updateCheck: UpdateCheckResult | null;
  firstRunChecked: boolean;
  odoodevInstalled: boolean;

  versions: VersionsResponse | null;
  activeVersions: string[];
  dashboardLoading: boolean;

  servers: Record<string, ServerState>;

  fetchAllDashboard: () => Promise<void>;
  checkOdoodevUpdate: () => Promise<void>;
  installOdoodev: () => Promise<void>;
  updateOdoodev: () => Promise<void>;
  checkUvStatus: () => Promise<void>;
  checkOdoodevStatus: () => Promise<void>;
  startServer: (args: StartServerArgs) => Promise<number>;
  stopServer: (version: string, keepDocker?: boolean, force?: boolean) => Promise<void>;
  appendLog: (version: string, entry: OdooLogEntry) => void;
  clearLog: (version: string) => void;
  setServerStatus: (version: string, status: ServerStatus) => void;
  initServerTab: (version: string) => void;
  setServerConfig: (version: string, config: StartServerArgs) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  odoodevVersion: null,
  pypiVersion: null,
  uvInfo: null,
  odoodevInfo: null,
  updateCheck: null,
  firstRunChecked: false,
  odoodevInstalled: false,
  versions: null,
  activeVersions: [],
  dashboardLoading: false,
  servers: {},

  fetchAllDashboard: async () => {
    set({ dashboardLoading: true });
    try {
      const status = await invokeCmd<DashboardStatus>("get_all_dashboard_status");
      set({
        versions: status.versions,
        activeVersions: status.active_versions,
        dashboardLoading: false,
      });
    } catch (e) {
      console.error("fetchAllDashboard:", e);
      set({ dashboardLoading: false });
    }
  },

  checkOdoodevUpdate: async () => {
    try {
      const result = await invokeCmd<UpdateCheckResult>("check_odoodev_update");
      set({ updateCheck: result });
    } catch (e) {
      console.error("checkOdoodevUpdate:", e);
    }
  },

  installOdoodev: async () => {
    try {
      const info = await invokeCmd<OdoodevInfoDto>("install_odoodev");
      set({ odoodevInfo: info, odoodevInstalled: info.installed });
    } catch (e) {
      console.error("installOdoodev:", e);
    }
  },

  updateOdoodev: async () => {
    try {
      const info = await invokeCmd<OdoodevInfoDto>("upgrade_odoodev");
      set({ odoodevInfo: info, odoodevInstalled: info.installed });
      await get().checkOdoodevUpdate();
    } catch (e) {
      console.error("updateOdoodev:", e);
    }
  },

  checkUvStatus: async () => {
    try {
      const info = await invokeCmd<UvInfoDto>("check_uv_status_cmd");
      set({ uvInfo: info });
    } catch (e) {
      console.error("checkUvStatus:", e);
    }
  },

  checkOdoodevStatus: async () => {
    try {
      const info = await invokeCmd<OdoodevInfoDto>("check_odoodev");
      set({ odoodevInfo: info, odoodevInstalled: info.installed });
    } catch (e) {
      console.error("checkOdoodevStatus:", e);
    }
  },

  startServer: async (args: StartServerArgs) => {
    const result = await invokeCmd<{ pid: number; port: number }>("start_server", { args });
    get().initServerTab(args.version);
    set((state) => ({
      servers: {
        ...state.servers,
        [args.version]: {
          ...state.servers[args.version],
          status: { running: true, pid: result.pid, uptime_seconds: 0, port: result.port },
          config: args,
        },
      },
    }));
    return result.pid;
  },

  stopServer: async (version: string, keepDocker: boolean = true, force: boolean = false) => {
    await invokeCmd("stop_server", { version, keepDocker, force });
    set((state) => ({
      servers: {
        ...state.servers,
        [version]: {
          ...state.servers[version],
          status: { running: false, pid: null, uptime_seconds: null, port: null },
        },
      },
    }));
  },

  appendLog: (version: string, entry: OdooLogEntry) => {
    set((state) => {
      const existing = state.servers[version];
      const buffer = existing?.logBuffer ?? [];
      const newBuffer = [...buffer, entry];
      if (newBuffer.length > LOG_BUFFER_CAP) {
        newBuffer.splice(0, newBuffer.length - LOG_BUFFER_CAP);
      }
      return {
        servers: {
          ...state.servers,
          [version]: { status: existing?.status ?? null, logBuffer: newBuffer, config: existing?.config ?? null },
        },
      };
    });
  },

  clearLog: (version: string) => {
    set((state) => {
      const existing = state.servers[version];
      if (!existing) return state;
      return {
        servers: {
          ...state.servers,
          [version]: { ...existing, logBuffer: [] },
        },
      };
    });
  },

  setServerStatus: (version: string, status: ServerStatus) => {
    set((state) => {
      const existing = state.servers[version];
      return {
        servers: {
          ...state.servers,
          [version]: { status, logBuffer: existing?.logBuffer ?? [], config: existing?.config ?? null },
        },
      };
    });
  },

  initServerTab: (version: string) => {
    set((state) => {
      if (state.servers[version]) return state;
      return {
        servers: {
          ...state.servers,
          [version]: { status: null, logBuffer: [], config: null },
        },
      };
    });
  },

  setServerConfig: (version: string, config: StartServerArgs) => {
    set((state) => {
      const existing = state.servers[version];
      return {
        servers: {
          ...state.servers,
          [version]: { status: existing?.status ?? null, logBuffer: existing?.logBuffer ?? [], config },
        },
      };
    });
  },
}));