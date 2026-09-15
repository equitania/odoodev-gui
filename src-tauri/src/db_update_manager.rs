//! Running `odoodev db update` processes — at most one per Odoo version.
//!
//! The spawned task owns the `Child` (it awaits the exit and emits
//! `db-update-exited`); the manager only keeps the pid and a channel to ask
//! that task for a forced kill, so no lock is ever held across an await.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::mpsc::UnboundedSender;

#[derive(Clone)]
struct RunHandle {
    pid: u32,
    force_kill: UnboundedSender<()>,
    /// Whether a graceful SIGTERM has already been sent for this run. A
    /// second SIGTERM while odoodev is already cleaning up after the first
    /// risks leaving odoo-bin running, so the graceful path signals at most
    /// once per run; a forced kill is always allowed regardless.
    signalled: bool,
}

#[derive(Clone, Default)]
pub struct DbUpdateManager {
    runs: Arc<Mutex<HashMap<String, RunHandle>>>,
    shutting_down: Arc<AtomicBool>,
}

impl DbUpdateManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_running(&self, version: &str) -> bool {
        self.runs.lock().unwrap().contains_key(version)
    }

    pub fn versions(&self) -> Vec<String> {
        let mut versions: Vec<String> = self.runs.lock().unwrap().keys().cloned().collect();
        versions.sort();
        versions
    }

    pub fn insert(
        &self,
        version: String,
        pid: u32,
        force_kill: UnboundedSender<()>,
    ) -> Result<(), String> {
        let mut runs = self.runs.lock().unwrap();
        if runs.contains_key(&version) {
            return Err(format!("An update is already running for v{version}"));
        }
        runs.insert(
            version,
            RunHandle {
                pid,
                force_kill,
                signalled: false,
            },
        );
        Ok(())
    }

    pub fn remove(&self, version: &str) {
        self.runs.lock().unwrap().remove(version);
    }

    /// `force = false`: SIGTERM, so odoodev kills Odoo's process group and exits
    /// 130 — sent at most once per run; a repeat call is a no-op `Ok(())`.
    /// `force = true` (or no signals, i.e. Windows): the owning task kills
    /// odoodev directly — odoo-bin may survive that. A forced kill is always
    /// sent, even after a prior graceful SIGTERM.
    pub fn cancel(&self, version: &str, force: bool) -> Result<(), String> {
        if force || !cfg!(unix) {
            let handle = self
                .runs
                .lock()
                .unwrap()
                .get(version)
                .cloned()
                .ok_or_else(|| format!("No update running for v{version}"))?;
            return handle
                .force_kill
                .send(())
                .map_err(|_| "The update has already finished".to_string());
        }

        // Graceful (unix) path: flip the signalled flag under the lock, then
        // signal outside it — libc::kill is non-blocking, so this isn't
        // strictly necessary, but it keeps the lock scope minimal.
        let (pid, already_signalled) = {
            let mut runs = self.runs.lock().unwrap();
            let handle = runs
                .get_mut(version)
                .ok_or_else(|| format!("No update running for v{version}"))?;
            let already = handle.signalled;
            handle.signalled = true;
            (handle.pid, already)
        };
        if already_signalled {
            return Ok(());
        }
        terminate(pid)
    }

    /// True exactly once — the first exit request starts the graceful shutdown,
    /// the follow-up exit is let through.
    pub fn begin_shutdown(&self) -> bool {
        !self.shutting_down.swap(true, Ordering::SeqCst)
    }

    pub async fn terminate_all_and_wait(&self, timeout: Duration) {
        for version in self.versions() {
            let _ = self.cancel(&version, false);
        }
        let deadline = tokio::time::Instant::now() + timeout;
        while !self.versions().is_empty() && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

#[cfg(unix)]
fn terminate(pid: u32) -> Result<(), String> {
    // SAFETY: kill(2) on a pid this process spawned and still tracks; no memory is involved.
    let rc = unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
    if rc == 0 {
        Ok(())
    } else {
        Err(format!(
            "Could not signal odoodev (pid {pid}): {}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(not(unix))]
fn terminate(_pid: u32) -> Result<(), String> {
    Err("Signals are not supported on this platform".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    #[test]
    fn rejects_a_second_run_on_the_same_version() {
        let m = DbUpdateManager::new();
        let (tx, _rx) = unbounded_channel();
        m.insert("19".into(), 1, tx.clone()).unwrap();
        assert!(m.insert("19".into(), 2, tx.clone()).is_err());
        assert!(m.insert("18".into(), 3, tx).is_ok());
        assert_eq!(m.versions(), vec!["18", "19"]);
        assert!(m.is_running("19"));
        m.remove("19");
        assert!(!m.is_running("19"));
    }

    #[test]
    fn force_cancel_asks_the_owning_task_to_kill() {
        let m = DbUpdateManager::new();
        let (tx, mut rx) = unbounded_channel();
        m.insert("19".into(), 1, tx).unwrap();
        m.cancel("19", true).unwrap();
        assert!(rx.try_recv().is_ok());
    }

    #[test]
    fn cancel_without_a_run_is_an_error() {
        assert!(DbUpdateManager::new().cancel("19", false).is_err());
    }

    #[test]
    fn shutdown_begins_only_once() {
        let m = DbUpdateManager::new();
        assert!(m.begin_shutdown());
        assert!(!m.begin_shutdown());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn terminate_all_sends_sigterm_and_waits_for_the_exit() {
        let m = DbUpdateManager::new();
        let mut child = tokio::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let pid = child.id().unwrap();
        let (tx, _rx) = unbounded_channel();
        m.insert("19".into(), pid, tx).unwrap();
        let owner = m.clone();
        let waiter = tokio::spawn(async move {
            let status = child.wait().await.unwrap();
            owner.remove("19");
            status
        });
        let started = std::time::Instant::now();
        m.terminate_all_and_wait(Duration::from_secs(5)).await;
        assert!(m.versions().is_empty());
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(!waiter.await.unwrap().success());
    }

    /// A second SIGTERM while odoodev is already cleaning up after the first
    /// was a real risk of leaving odoo-bin running — the graceful path must
    /// signal at most once, while a forced kill remains available afterwards.
    ///
    /// A `sleep`'d child can't tell two SIGTERMs from one (kill(2) on a
    /// zombie still returns 0), so this spawns a shell that traps TERM and
    /// prints a line each time it fires — that count is the actual proof
    /// that at most one signal reached the process.
    #[cfg(unix)]
    #[tokio::test]
    async fn graceful_cancel_signals_sigterm_at_most_once_but_force_still_works() {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let m = DbUpdateManager::new();
        let mut child = tokio::process::Command::new("sh")
            .arg("-c")
            .arg("trap 'echo T' TERM; echo READY; while :; do sleep 0.05; done")
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let pid = child.id().unwrap();
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();

        // Wait for the trap to actually be installed before signalling —
        // otherwise a SIGTERM that arrives before the shell reaches the
        // `trap` statement falls back to the default action (terminate) and
        // the test would flakily "pass" for the wrong reason.
        assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("READY"));

        let (tx, mut rx) = unbounded_channel();
        m.insert("19".into(), pid, tx).unwrap();

        assert!(m.cancel("19", false).is_ok());
        tokio::time::sleep(Duration::from_millis(200)).await;

        // A repeat graceful cancel is a no-op — it must not signal again.
        assert!(m.cancel("19", false).is_ok());
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(rx.try_recv().is_err());

        // A forced kill is still allowed after a prior graceful SIGTERM.
        assert!(m.cancel("19", true).is_ok());
        assert!(rx.try_recv().is_ok());

        let _ = child.start_kill();
        let _ = child.wait().await;

        let mut term_traps = 0;
        while let Ok(Some(line)) = lines.next_line().await {
            if line == "T" {
                term_traps += 1;
            }
        }
        assert_eq!(
            term_traps, 1,
            "expected exactly one SIGTERM to reach the process, got {term_traps}"
        );
    }
}
