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
    /// Level used for filtering: RAW continuation lines (tracebacks, wrapped
    /// output) inherit the level of the preceding parsed line.
    pub effective_level: LogLevel,
    /// True only for GUI-synthesized separator markers (e.g. "server stopped").
    pub is_separator: bool,
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
            effective_level: level,
            is_separator: false,
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
            effective_level: LogLevel::Raw,
            is_separator: false,
            database: String::new(),
            logger: String::new(),
            message: stripped.to_string(),
            raw: stripped.to_string(),
        }
    }
}

/// Parse a line with stream context: RAW continuation lines inherit
/// `last_level` (the level of the most recent parsed line on this stream)
/// so level filtering also applies to tracebacks and wrapped output.
pub fn parse_line_with_level(line: &str, last_level: LogLevel) -> OdooLogEntry {
    let mut entry = parse_line(line);
    if entry.level == LogLevel::Raw {
        entry.effective_level = last_level;
    }
    entry
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

    #[test]
    fn continuation_lines_inherit_effective_level() {
        let lines = [
            "2025-07-10 14:23:48,012 12345 ERROR v18_exam odoo.sql_db: Connection failed",
            "Traceback (most recent call last):",
            "  File \"/opt/odoo/odoo/sql_db.py\", line 42, in connect",
        ];
        let mut last_level = LogLevel::Info;
        let mut entries = Vec::new();
        for line in lines {
            let entry = parse_line_with_level(line, last_level);
            if entry.level != LogLevel::Raw {
                last_level = entry.level;
            }
            entries.push(entry);
        }
        assert_eq!(entries[0].level, LogLevel::Error);
        assert_eq!(entries[0].effective_level, LogLevel::Error);
        assert_eq!(entries[1].level, LogLevel::Raw);
        assert_eq!(entries[1].effective_level, LogLevel::Error);
        assert_eq!(entries[2].level, LogLevel::Raw);
        assert_eq!(entries[2].effective_level, LogLevel::Error);
    }

    #[test]
    fn raw_before_first_parsed_line_uses_given_default() {
        let e = parse_line_with_level("Werkzeug banner line", LogLevel::Info);
        assert_eq!(e.level, LogLevel::Raw);
        assert_eq!(e.effective_level, LogLevel::Info);
        assert!(!e.is_separator);
    }
}
