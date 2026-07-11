import { toastError } from "../store/toastStore";

/**
 * Error handler for a non-critical background failure — a one-time mount fetch
 * or similar. Logs with context so the failure is debuggable, but does not
 * interrupt the user. Use as `promise.catch(logError("Component: what failed"))`.
 *
 * Note: polling calls intentionally stay silent (no handler) to avoid spamming
 * the console every interval when a backend/service is down.
 */
export function logError(context: string) {
  return (e: unknown) => console.error(`${context}:`, e);
}

/**
 * Error handler for a user-initiated action (button click). Logs the failure and
 * surfaces a toast so the user sees that their action did not succeed. Use as
 * `promise.catch(reportError("Failed to start PostgreSQL"))`.
 */
export function reportError(message: string) {
  return (e: unknown) => {
    console.error(`${message}:`, e);
    toastError(message, String(e));
  };
}
