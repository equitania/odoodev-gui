use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum LogLevel {
    Debug,
    Info,
    Warning,
    Error,
    Critical,
    Raw,
}

impl LogLevel {
    pub fn from_str(s: &str) -> Self {
        match s {
            "DEBUG" => LogLevel::Debug,
            "INFO" => LogLevel::Info,
            "WARNING" => LogLevel::Warning,
            "ERROR" => LogLevel::Error,
            "CRITICAL" => LogLevel::Critical,
            _ => LogLevel::Raw,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct OdooLogEntry {
    pub timestamp: String,
    pub pid: String,
    pub level: LogLevel,
    pub database: String,
    pub logger: String,
    pub message: String,
    pub raw: String,
}

static LOG_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d+)\s+(\d+)\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+(\S+)\s+(\S+?):\s*(.*)",
    )
    .unwrap()
});

pub fn parse_line(line: &str) -> OdooLogEntry {
    let stripped = line.trim_end_matches(['\n', '\r']);
    if let Some(caps) = LOG_PATTERN.captures(stripped) {
        let level = LogLevel::from_str(&caps[3]);
        OdooLogEntry {
            timestamp: caps[1].to_string(),
            pid: caps[2].to_string(),
            level,
            database: caps[4].to_string(),
            logger: caps[5].to_string(),
            message: caps[6].to_string(),
            raw: stripped.to_string(),
        }
    } else {
        OdooLogEntry {
            timestamp: String::new(),
            pid: String::new(),
            level: LogLevel::Raw,
            database: String::new(),
            logger: String::new(),
            message: stripped.to_string(),
            raw: stripped.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_info_line() {
        let line = "2025-07-10 14:23:45,123 12345 INFO  v18_exam odoo.modules.loading: Loading module eq_sale";
        let e = parse_line(line);
        assert_eq!(e.level, LogLevel::Info);
        assert_eq!(e.pid, "12345");
        assert_eq!(e.database, "v18_exam");
        assert_eq!(e.logger, "odoo.modules.loading");
        assert_eq!(e.message, "Loading module eq_sale");
    }

    #[test]
    fn parses_error_line() {
        let line = "2025-07-10 14:23:48,012 12345 ERROR v18_exam odoo.sql_db: Connection failed";
        let e = parse_line(line);
        assert_eq!(e.level, LogLevel::Error);
        assert_eq!(e.database, "v18_exam");
    }

    #[test]
    fn raw_for_traceback() {
        let line = "  Traceback (most recent call last):";
        let e = parse_line(line.trim_end());
        assert_eq!(e.level, LogLevel::Raw);
        assert!(e.timestamp.is_empty());
    }

    #[test]
    fn raw_for_blank() {
        let e = parse_line("");
        assert_eq!(e.level, LogLevel::Raw);
    }
}