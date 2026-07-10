import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "../store/appStore";
import type { OdooLogEntry, ServerStatus } from "../types";

export function useLogStream(version: string) {
  const appendLog = useAppStore((s) => s.appendLog);
  const setServerStatus = useAppStore((s) => s.setServerStatus);
  const initServerTab = useAppStore((s) => s.initServerTab);
  const stopServer = useAppStore((s) => s.stopServer);

  useEffect(() => {
    initServerTab(version);
    let unlistens: UnlistenFn[] = [];

    (async () => {
      const u1 = await listen<OdooLogEntry>(`odoodev-log:${version}`, (event) => {
        appendLog(version, event.payload);
      });
      unlistens.push(u1);

      const u2 = await listen<ServerStatus>(`server-status:${version}`, (event) => {
        setServerStatus(version, event.payload);
      });
      unlistens.push(u2);

      const u3 = await listen<{ exit_code: number }>(`server-exited:${version}`, () => {
        const sep: OdooLogEntry = {
          timestamp: "",
          pid: "",
          level: "RAW",
          database: "",
          logger: "",
          message: `--- Server stopped ---`,
          raw: "--- Server stopped ---",
        };
        appendLog(version, sep);
        setServerStatus(version, { running: false, pid: null, uptime_seconds: null, port: null });
      });
      unlistens.push(u3);
    })();

    return () => {
      unlistens.forEach((u) => u());
    };
  }, [version, appendLog, setServerStatus, initServerTab, stopServer]);
}