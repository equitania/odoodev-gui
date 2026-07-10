use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::process::Child;

pub struct OdooProcess {
    pub child: Option<Child>,
    pub pid: u32,
    pub started_at: chrono::DateTime<Utc>,
    pub port: u16,
}

pub struct ServerManager {
    processes: Arc<Mutex<HashMap<String, OdooProcess>>>,
}

impl Default for ServerManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Clone for ServerManager {
    fn clone(&self) -> Self {
        Self {
            processes: Arc::clone(&self.processes),
        }
    }
}

impl ServerManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn is_running(&self, version: &str) -> bool {
        self.processes.lock().unwrap().contains_key(version)
    }

    pub fn get_pid(&self, version: &str) -> Option<u32> {
        self.processes
            .lock()
            .unwrap()
            .get(version)
            .map(|p| p.pid)
    }

    pub fn get_uptime(&self, version: &str) -> Option<u64> {
        self.processes
            .lock()
            .unwrap()
            .get(version)
            .map(|p| (Utc::now() - p.started_at).num_seconds().max(0) as u64)
    }

    pub fn get_port(&self, version: &str) -> Option<u16> {
        self.processes
            .lock()
            .unwrap()
            .get(version)
            .map(|p| p.port)
    }

    pub fn insert(&self, version: String, child: Child, pid: u32, port: u16) {
        self.processes.lock().unwrap().insert(
            version,
            OdooProcess {
                child: Some(child),
                pid,
                started_at: Utc::now(),
                port,
            },
        );
    }

    pub fn remove(&self, version: &str) {
        self.processes.lock().unwrap().remove(version);
    }

    pub fn versions(&self) -> Vec<String> {
        self.processes
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect()
    }
}