import { useState, useEffect } from "react";
import { invokeCmd } from "../../lib/tauri";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader } from "../ui/card";
import {
  Stethoscope,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { DoctorResult } from "../../types";

function statusIcon(status: string) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === "fail") return <XCircle className="h-4 w-4 text-red-500" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  return null;
}

function statusBadge(status: string) {
  if (status === "ok") return <Badge variant="success">OK</Badge>;
  if (status === "fail") return <Badge variant="error">FAIL</Badge>;
  if (status === "warn") return <Badge variant="warning">WARN</Badge>;
  return <Badge variant="neutral">—</Badge>;
}

function DoctorCheckRow({ check }: { check: DoctorResult["checks"][number] }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
      {statusIcon(check.status)}
      <div className="flex-1">
        <div className="text-sm font-mono font-medium">{check.name}</div>
        <div className="text-xs text-muted-foreground">{check.message}</div>
      </div>
      {statusBadge(check.status)}
    </div>
  );
}

function DoctorResultCard({ result }: { result: DoctorResult }) {
  const [expanded, setExpanded] = useState(false);
  const okCount = result.checks.filter((c) => c.status === "ok").length;
  const failCount = result.checks.filter((c) => c.status === "fail").length;
  const warnCount = result.checks.filter((c) => c.status === "warn").length;

  const headerColor =
    result.overall === "ok"
      ? "border-green-500/30"
      : result.overall === "fail"
        ? "border-red-500/30"
        : "border-yellow-500/30";

  return (
    <Card className={headerColor}>
      <CardHeader>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between w-full"
        >
          <div className="flex items-center gap-3">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-semibold">
              {result.version ? `v${result.version}` : "General"}
            </span>
            {result.overall === "ok" ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : result.overall === "fail" ? (
              <XCircle className="h-5 w-5 text-red-500" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {okCount > 0 && <span className="text-green-500">{okCount} ok</span>}
            {warnCount > 0 && <span className="text-yellow-500">{warnCount} warn</span>}
            {failCount > 0 && <span className="text-red-500">{failCount} fail</span>}
          </div>
        </button>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-2">
          {result.checks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No checks parsed. Raw output:
            </p>
          ) : (
            result.checks.map((check, i) => (
              <DoctorCheckRow key={i} check={check} />
            ))
          )}
          {result.checks.length === 0 && (
            <pre className="max-h-48 overflow-auto rounded-md bg-black/90 p-3 font-mono text-xs text-green-400">
              {result.raw_output}
            </pre>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function DoctorPanel() {
  const [results, setResults] = useState<DoctorResult[]>([]);
  const [generalResult, setGeneralResult] = useState<DoctorResult | null>(null);
  const [running, setRunning] = useState(false);

  const runDoctor = async () => {
    setRunning(true);
    const tid = toastLoading("Running doctor checks...");
    try {
      const [general, allVersions] = await Promise.all([
        invokeCmd<DoctorResult>("doctor_general"),
        invokeCmd<DoctorResult[]>("doctor_all_versions"),
      ]);
      setGeneralResult(general);
      setResults(allVersions);
      const allOk = general.all_ok && allVersions.every((r) => r.all_ok);
      if (allOk) {
        toastUpdate(tid, "success", "All health checks passed");
      } else {
        toastUpdate(tid, "error", "Some checks failed", "See details below");
      }
    } catch (e) {
      toastUpdate(tid, "error", "Doctor run failed", String(e));
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    runDoctor();
  }, []);

  const sortedResults = [...results].sort((a, b) => {
    const va = a.version ?? "";
    const vb = b.version ?? "";
    return va.localeCompare(vb);
  });

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Health Check</h1>
          </div>
          <Button
            variant="outline"
            onClick={runDoctor}
            disabled={running}
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Re-run
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Checks prerequisites (uv, Docker/Apple Container, PostgreSQL, Node.js,
          system libs) and version-specific PostgreSQL port + venv packages.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {running && results.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {generalResult && (
          <DoctorResultCard result={generalResult} />
        )}

        {sortedResults.map((r) => (
          <DoctorResultCard key={r.version ?? "unknown"} result={r} />
        ))}

        {!running && results.length === 0 && !generalResult && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">No results yet. Click "Re-run" to start.</p>
          </div>
        )}
      </div>
    </div>
  );
}