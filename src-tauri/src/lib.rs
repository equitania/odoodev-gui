mod commands;
mod config;
mod db_update;
mod db_update_manager;
mod docker_check;
mod installer;
mod log_parser;
mod models;
mod odoodev;
mod pypi;
mod server_manager;

use commands::database;
use commands::db_update as db_update_cmd;
use commands::docker;
use commands::doctor;
use commands::editor;
use commands::env;
use commands::export;
use commands::init_cmd;
use commands::migrate;
use commands::playbook;
use commands::repos;
use commands::self_update;
use commands::server;
use commands::system;
use commands::venv;
use commands::versions;
use db_update_manager::DbUpdateManager;
use server_manager::ServerManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ServerManager::new())
        .manage(DbUpdateManager::new())
        .manage(editor::EditorRoots::new())
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
            database::check_postgres_port,
            database::backup_db,
            database::restore_db,
            database::drop_db,
            database::copy_db,
            database::rename_db,
            // module list export (odoodev >= 0.59.0, --via-shell >= 0.76.0)
            export::export_modules,
            // database updates (odoodev >= 0.69.0)
            db_update_cmd::plan_db_update,
            db_update_cmd::start_db_update,
            db_update_cmd::cancel_db_update,
            db_update_cmd::list_db_updates,
            db_update_cmd::read_update_log,
            // docker
            docker::docker_up,
            docker::docker_down,
            docker::docker_status,
            docker::list_containers,
            docker::get_runtime_info,
            docker::runtime_system_start,
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
            playbook::playbook_inspect,
            playbook::playbook_run,
            playbook::playbook_schema,
            playbook::playbook_create,
            playbook::playbook_check_output,
            playbook::playbook_env_dirs,
            playbook::playbook_validate,
            // editor (curated files)
            editor::curated_files,
            editor::fs_read_file,
            editor::fs_write_file,
            editor::validate_yaml,
            editor::playbook_validate_semantic,
            // init / setup
            init_cmd::init_version,
            init_cmd::setup_config,
            // migrate
            migrate::migrate_list,
            migrate::migrate_status,
            migrate::migrate_create,
            migrate::migrate_activate,
            migrate::migrate_deactivate,
            migrate::migrate_remove,
            // doctor
            doctor::doctor_general,
            doctor::doctor_run,
            doctor::doctor_all_versions,
            // runtime detection
            versions::get_runtime,
            versions::get_runtime_config,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match &event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                let updates = app.state::<DbUpdateManager>().inner().clone();
                // Closing the GUI must not orphan odoo-bin: SIGTERM every running
                // update, wait up to 10 s, then exit for real. begin_shutdown() is
                // one-shot, so the exit triggered below passes straight through.
                if !updates.versions().is_empty() && updates.begin_shutdown() {
                    api.prevent_exit();
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        updates
                            .terminate_all_and_wait(std::time::Duration::from_secs(10))
                            .await;
                        handle.exit(0);
                    });
                }
            }
            tauri::RunEvent::Exit => {
                // Cmd+Q on macOS (applicationWillTerminate) and the updater
                // relaunch reach Exit without a preventable ExitRequested. Block
                // the main thread here; the owning tasks keep running on the
                // runtime threads and remove each run as its process exits.
                // Runs already signalled are skipped, and the deadline is shared
                // with the window-close wait, so this never exceeds 10 s in total.
                app.state::<DbUpdateManager>()
                    .terminate_all_and_wait_blocking(std::time::Duration::from_secs(10));
            }
            _ => {}
        });
}
