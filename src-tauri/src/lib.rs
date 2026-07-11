mod commands;
mod config;
mod docker_check;
mod installer;
mod log_parser;
mod models;
mod odoodev;
mod pypi;
mod server_manager;

use commands::database;
use commands::docker;
use commands::env;
use commands::playbook;
use commands::repos;
use commands::self_update;
use commands::server;
use commands::system;
use commands::venv;
use commands::versions;
use server_manager::ServerManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ServerManager::new())
        .invoke_handler(tauri::generate_handler![
            // versions / dashboard
            versions::get_versions,
            versions::get_venv_status,
            versions::get_active_versions,
            versions::get_docker_status,
            versions::get_server_status,
            versions::get_all_server_statuses,
            versions::get_all_dashboard_status,
            versions::get_odoo_log_entry,
            // self-update / system
            self_update::get_pypi_version,
            self_update::check_odoodev_update,
            self_update::upgrade_odoodev,
            self_update::get_app_version,
            self_update::check_uv_status_cmd,
            system::get_platform_info,
            system::open_external,
            // uv / odoodev install
            versions::check_uv,
            versions::install_uv,
            versions::check_odoodev,
            versions::install_odoodev,
            // server
            server::start_server,
            server::stop_server,
            server::get_server_status_cmd,
            // databases
            database::get_databases,
            database::backup_db,
            database::restore_db,
            database::drop_db,
            database::copy_db,
            database::rename_db,
            // docker
            docker::docker_up,
            docker::docker_down,
            docker::docker_status,
            docker::list_containers,
            docker::get_runtime_info,
            docker::docker_logs,
            docker::docker_bench,
            // venv
            venv::venv_setup,
            venv::venv_remove,
            // repos
            repos::repos_run,
            repos::repos_pull,
            // env
            env::env_check,
            env::env_dir,
            env::env_show,
            env::env_setup,
            // playbook
            playbook::playbook_list,
            playbook::playbook_valid_steps,
            playbook::playbook_run,
            // runtime detection
            versions::get_runtime,
            versions::get_runtime_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
