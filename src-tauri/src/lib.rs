mod ffmpeg;

use tauri::Manager;

fn open_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            open_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ffmpeg::FfState::default())
        .invoke_handler(tauri::generate_handler![
            ffmpeg::ffmpeg_ok,
            ffmpeg::media_probe,
            ffmpeg::thumbnails,
            ffmpeg::ff_run,
            ffmpeg::ff_cancel,
            ffmpeg::unique_path,
            ffmpeg::concat_list,
            ffmpeg::tmp_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Garante que nenhum ffmpeg fica órfão quando o app sai.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<ffmpeg::FfState>() {
                    ffmpeg::kill_all(&state);
                }
            }
        });
}
