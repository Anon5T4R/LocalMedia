mod ffmpeg;
mod storage;

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
    // ── Contorno da tela branca do webkit: REMOVIDO, e o porquê importa ──────
    //
    // Este bloco desligava o renderer DMABUF, desligava o compositing e forçava
    // XWayland, porque o webkit2gtk pintava a janela inteira de branco em
    // Arch/GNOME. Era mitigação às cegas — o comentário dizia "branco é pior que
    // lento" — e custava a aceleração do WebView.
    //
    // A CAUSA foi encontrada em 26/07/2026 e é de EMPACOTAMENTO, não de código:
    // o AppDir do AppImage levava `libwayland-*` do Ubuntu do CI, que brigavam
    // com o Mesa do host e derrubavam o EGL (`EGL_BAD_PARAMETER`). Corrigido em
    // `Anon5T4R/linux-packaging`: as libs que falam com driver/compositor agora
    // vêm do host, e o pacote nativo (pacman/apt) usa o webkit do sistema.
    // Tratar o sintoma deixou de fazer sentido.
    //
    // Remover o forçamento NÃO tira a saída de emergência: estas variáveis são
    // lidas pelo próprio webkitgtk, não por este código. Se a tela branca voltar
    // em alguma combinação de driver, rodar com
    // `WEBKIT_DISABLE_DMABUF_RENDERER=1` continua funcionando — e aí é sinal de
    // que sobrou lib de host em algum AppDir, que é onde se deve olhar.

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            open_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ffmpeg::FfState::default())
        // Carimba o início da sessão. É metade do critério de "sobra": id de
        // miniatura não é persistido, então pasta anterior a este instante não
        // tem como ser referenciada por ninguém.
        .manage(storage::StartedAt::default())
        .invoke_handler(tauri::generate_handler![
            ffmpeg::ffmpeg_ok,
            ffmpeg::media_probe,
            ffmpeg::thumbnails,
            ffmpeg::ff_run,
            ffmpeg::ff_cancel,
            ffmpeg::unique_path,
            ffmpeg::concat_list,
            ffmpeg::tmp_path,
            ffmpeg::write_text_file,
            ffmpeg::read_text_file,
            storage::storage_info,
            storage::storage_clear_old_thumbs,
            storage::storage_clear_old_tmp
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
