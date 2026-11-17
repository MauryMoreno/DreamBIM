mod assistant;
mod commands;
mod fs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(assistant::bridge::Bridge::new())
        .setup(|app| {
            // the Assistant bridge emits events to the window; the Python process is not launched until the panel opens
            use tauri::Manager;
            app.state::<std::sync::Arc<assistant::bridge::Bridge>>().set_app(app.handle().clone());
            // the disk commands only reach folders the user picked, plus the Assistant project folder
            let project = assistant::layout::detect().map(|(_, project)| project).ok();
            let always: Vec<std::path::PathBuf> = project.into_iter().collect();
            app.manage(fs::scope::init(&app.path().app_data_dir()?, &always));
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::files::read_text_file,
            commands::files::write_text_file,
            commands::files::write_binary_file,
            commands::files::read_binary_file,
            commands::documents::store_document,
            commands::documents::make_document_folder,
            commands::documents::open_document,
            commands::library::list_folder,
            commands::library::path_exists,
            commands::library::file_mtime,
            commands::library::list_library,
            commands::library::search_library,
            commands::pickers::pick_open_file,
            commands::pickers::pick_save_path,
            commands::pickers::pick_folder,
            assistant::commands::chat_stream,
            assistant::commands::send_request,
            assistant::commands::conv_request,
            assistant::commands::tool_confirm,
            assistant::commands::ask_answer,
            assistant::commands::cancel_stream,
            assistant::commands::studio_result,
            assistant::commands::bridge_status,
            assistant::commands::restart_bridge,
            assistant::commands::graph_request,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // the Python process must not outlive the window
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                let bridge = app.state::<std::sync::Arc<assistant::bridge::Bridge>>().inner().clone();
                tauri::async_runtime::block_on(bridge.shutdown());
            }
        });
}
