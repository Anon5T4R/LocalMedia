//! Execução do ffmpeg/ffprobe embarcados (binaries/ffmpeg).
//!
//! Os ARGUMENTOS de cada job são montados no front (src/lib/presets.ts, puro e
//! unit-testado); aqui só resolvemos o binário, injetamos `-progress pipe:1`
//! (progresso ESTRUTURADO — regra do plano: nunca regex no log humano),
//! repassamos eventos pro front e permitimos cancelar (kill por job id).

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager, State};

#[derive(Default)]
pub struct FfState {
    pub jobs: Mutex<HashMap<String, Child>>,
}

const FFMPEG_BIN: &str = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
const FFPROBE_BIN: &str = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };

/// Localiza um binário embarcado. Dev: cwd/binaries/ffmpeg. Prod: resource dir.
fn resolve_bin(app: &tauri::AppHandle, bin: &str) -> Result<PathBuf, String> {
    let rel = format!("binaries/ffmpeg/{}", bin);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join(&rel));
    }
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join(&rel));
        candidates.push(res.join(format!("ffmpeg/{}", bin)));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(&rel));
            candidates.push(dir.join(format!("ffmpeg/{}", bin)));
        }
    }
    for c in candidates {
        if c.exists() {
            return Ok(c);
        }
    }
    Err(format!("{} não encontrado (runtime de mídia ausente)", bin))
}

fn no_window(cmd: &mut Command) {
    // Não abre janela de console no Windows (CREATE_NO_WINDOW).
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let _ = cmd; // no Linux não há o que fazer
}

/// O runtime está presente? (a UI avisa se não estiver)
#[tauri::command(async)]
pub fn ffmpeg_ok(app: tauri::AppHandle) -> bool {
    resolve_bin(&app, FFMPEG_BIN).is_ok() && resolve_bin(&app, FFPROBE_BIN).is_ok()
}

/// ffprobe em JSON (formato + streams). O parse fica no front.
#[tauri::command(async)]
pub fn media_probe(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let probe = resolve_bin(&app, FFPROBE_BIN)?;
    let mut cmd = Command::new(&probe);
    cmd.args([
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        &path,
    ])
    .stdin(Stdio::null());
    no_window(&mut cmd);
    let out = cmd.output().map_err(|e| format!("falha ao rodar ffprobe: {}", e))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("ffprobe não abriu o arquivo: {}", err.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Extrai `count` miniaturas espaçadas do vídeo pra timeline de corte.
/// Ficam em app_data/thumbs/<id>/ (o asset protocol serve de lá).
#[tauri::command(async)]
pub fn thumbnails(
    app: tauri::AppHandle,
    id: String,
    path: String,
    count: u32,
    duration_ms: u64,
) -> Result<Vec<String>, String> {
    let ffmpeg = resolve_bin(&app, FFMPEG_BIN)?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data indisponível: {}", e))?
        .join("thumbs")
        .join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("criar pasta de thumbs: {}", e))?;

    let count = count.clamp(1, 40);
    let mut out_paths = Vec::with_capacity(count as usize);
    for i in 0..count {
        // Centro de cada fatia, pra primeira/última não caírem em preto/créditos.
        let t_ms = duration_ms * (2 * i as u64 + 1) / (2 * count as u64);
        let out = dir.join(format!("{}.jpg", i));
        let mut cmd = Command::new(&ffmpeg);
        cmd.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &format!("{}.{:03}", t_ms / 1000, t_ms % 1000),
            "-i",
            &path,
            "-frames:v",
            "1",
            "-vf",
            "scale=168:-2",
            "-q:v",
            "5",
            "-y",
            &out.to_string_lossy(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
        no_window(&mut cmd);
        let status = cmd.status().map_err(|e| format!("falha ao rodar ffmpeg: {}", e))?;
        if status.success() && out.exists() {
            out_paths.push(out.to_string_lossy().to_string());
        }
    }
    if out_paths.is_empty() {
        return Err("não consegui extrair miniaturas (o arquivo tem vídeo?)".into());
    }
    Ok(out_paths)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct JobProgress {
    job_id: String,
    out_time_ms: u64,
    speed: String,
}

/// Interpreta uma linha do `-progress pipe:1`. Atenção histórica do ffmpeg:
/// `out_time_ms` vem em MICROSSEGUNDOS (nome mantido por compatibilidade).
fn parse_progress_line(line: &str) -> Option<(&str, String)> {
    let (k, v) = line.split_once('=')?;
    match k.trim() {
        "out_time_ms" | "out_time_us" => Some(("t", v.trim().to_string())),
        "speed" => Some(("speed", v.trim().to_string())),
        "progress" => Some(("progress", v.trim().to_string())),
        _ => None,
    }
}

/// Roda um job do ffmpeg com progresso estruturado + cancelamento.
/// `args` vem pronto do front; injetamos -y/-nostdin/-progress/-hide_banner.
#[tauri::command(async)]
pub fn ff_run(
    app: tauri::AppHandle,
    state: State<'_, FfState>,
    job_id: String,
    args: Vec<String>,
) -> Result<(), String> {
    let ffmpeg = resolve_bin(&app, FFMPEG_BIN)?;
    let mut cmd = Command::new(&ffmpeg);
    cmd.args(["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-loglevel", "error"])
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("falha ao iniciar ffmpeg: {}", e))?;
    let stdout = child.stdout.take().ok_or("sem stdout do ffmpeg")?;
    let stderr = child.stderr.take().ok_or("sem stderr do ffmpeg")?;

    // stderr (só erros, por causa do -loglevel error) num colecionador à parte —
    // ler os dois pipes evita deadlock e dá mensagem de erro útil.
    let err_tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let err_clone = err_tail.clone();
    let err_thread = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut v) = err_clone.lock() {
                v.push(line);
                let len = v.len();
                if len > 30 {
                    v.drain(0..len - 30);
                }
            }
        }
    });

    state.jobs.lock().map_err(|_| "estado corrompido")?.insert(job_id.clone(), child);

    let mut out_time_ms: u64 = 0;
    let mut speed = String::new();
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        match parse_progress_line(&line) {
            Some(("t", v)) => {
                // µs → ms.
                out_time_ms = v.parse::<i64>().unwrap_or(0).max(0) as u64 / 1000;
            }
            Some(("speed", v)) => speed = v,
            Some(("progress", _)) => {
                let _ = app.emit(
                    "ffjob-progress",
                    JobProgress { job_id: job_id.clone(), out_time_ms, speed: speed.clone() },
                );
            }
            _ => {}
        }
    }

    let mut child = state
        .jobs
        .lock()
        .map_err(|_| "estado corrompido")?
        .remove(&job_id)
        .ok_or("job sumiu do registro")?;
    let status = child.wait().map_err(|e| format!("esperar ffmpeg: {}", e))?;
    let _ = err_thread.join();

    if !status.success() {
        let tail = err_tail.lock().map(|v| v.join("\n")).unwrap_or_default();
        let msg = tail.trim();
        return Err(if msg.is_empty() { "ffmpeg interrompido".into() } else { msg.to_string() });
    }
    Ok(())
}

/// Cancela um job em andamento (mata o ffmpeg dele).
#[tauri::command(async)]
pub fn ff_cancel(state: State<'_, FfState>, job_id: String) {
    if let Ok(mut jobs) = state.jobs.lock() {
        if let Some(child) = jobs.get_mut(&job_id) {
            let _ = child.kill();
        }
    }
}

/// Mata qualquer ffmpeg vivo (chamado na saída do app).
pub fn kill_all(state: &FfState) {
    if let Ok(mut jobs) = state.jobs.lock() {
        for (_, child) in jobs.iter_mut() {
            let _ = child.kill();
        }
        jobs.clear();
    }
}

/// Caminho livre: acrescenta " (n)" antes da extensão até não colidir.
#[tauri::command(async)]
pub fn unique_path(path: String) -> String {
    unique_path_impl(&path, |p| std::path::Path::new(p).exists())
}

fn unique_path_impl(path: &str, exists: impl Fn(&str) -> bool) -> String {
    if !exists(path) {
        return path.to_string();
    }
    let p = std::path::Path::new(path);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("saida");
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
    let dir = p.parent().map(|d| d.to_path_buf()).unwrap_or_default();
    for n in 1..1000 {
        let name =
            if ext.is_empty() { format!("{} ({})", stem, n) } else { format!("{} ({}).{}", stem, n, ext) };
        let candidate = dir.join(name);
        let s = candidate.to_string_lossy().to_string();
        if !exists(&s) {
            return s;
        }
    }
    path.to_string()
}

/// Escreve a lista do concat demuxer (escapando aspas simples como o ffmpeg
/// exige) num arquivo temporário do app e devolve o caminho.
#[tauri::command(async)]
pub fn concat_list(app: tauri::AppHandle, id: String, files: Vec<String>) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data indisponível: {}", e))?
        .join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| format!("criar pasta tmp: {}", e))?;
    let list = dir.join(format!("{}.txt", id));
    let body = files
        .iter()
        .map(|f| format!("file '{}'", f.replace('\\', "/").replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(&list, body).map_err(|e| format!("gravar lista: {}", e))?;
    Ok(list.to_string_lossy().to_string())
}

/// Caminho em app_data/tmp pra artefatos intermediários (paleta do GIF etc).
#[tauri::command(async)]
pub fn tmp_path(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data indisponível: {}", e))?
        .join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| format!("criar pasta tmp: {}", e))?;
    // Sem separadores no nome — sempre dentro da tmp do app.
    let safe: String =
        name.chars().map(|c| if c.is_alphanumeric() || c == '.' || c == '-' { c } else { '_' }).collect();
    Ok(dir.join(safe).to_string_lossy().to_string())
}

/// Grava texto num caminho escolhido pelo usuário (projetos do editor —
/// o caminho vem sempre do diálogo de salvar).
#[tauri::command(async)]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("gravar {}: {}", path, e))
}

/// Lê texto de um caminho escolhido pelo usuário (diálogo de abrir).
#[tauri::command(async)]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("ler {}: {}", path, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progresso_estruturado() {
        assert_eq!(
            parse_progress_line("out_time_ms=1500000"),
            Some(("t", "1500000".to_string()))
        );
        assert_eq!(parse_progress_line("speed=2.31x"), Some(("speed", "2.31x".to_string())));
        assert_eq!(
            parse_progress_line("progress=continue"),
            Some(("progress", "continue".to_string()))
        );
        assert_eq!(parse_progress_line("frame=123"), None);
        assert_eq!(parse_progress_line("sem igual"), None);
    }

    #[test]
    fn unique_path_incrementa() {
        let taken = ["C:/v/a.mp4", "C:/v/a (1).mp4"];
        let got = unique_path_impl("C:/v/a.mp4", |p| taken.contains(&p.replace('\\', "/").as_str()));
        assert_eq!(got.replace('\\', "/"), "C:/v/a (2).mp4");
        let free = unique_path_impl("C:/v/b.mp4", |_| false);
        assert_eq!(free, "C:/v/b.mp4");
    }

    #[test]
    fn concat_escapa_aspas() {
        // Reproduz a regra de escape usada no concat_list.
        let f = "C:\\vídeos\\it's.mp4";
        let line = format!("file '{}'", f.replace('\\', "/").replace('\'', "'\\''"));
        assert_eq!(line, "file 'C:/vídeos/it'\\''s.mp4'");
    }
}
