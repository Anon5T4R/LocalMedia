//! Painel "Dados e armazenamento": mede o que o LocalMedia deixa em disco e
//! oferece limpezas que dizem exatamente o que apagam.
//!
//! Regra central: **o LocalMedia não guarda dado do usuário**. O que você
//! converte sai no caminho que VOCÊ escolheu no diálogo de salvar, e o projeto
//! do editor mora no navegador (autosave) ou num arquivo seu. Tudo o que está
//! em `app_data` aqui é rascunho de trabalho: as miniaturas que a UI mostra e
//! os intermediários do ffmpeg. Nenhum botão desta tela chega perto de um
//! arquivo seu.
//!
//! ## O achado que torna a limpeza provável
//!
//! As pastas de `thumbs/` são nomeadas por um id gerado em tempo de execução
//! (`Date.now() + random`, no front) e esse id **nunca é persistido**. Quando o
//! app fecha, todo id da sessão morre com ele — nenhum caminho do código
//! consegue voltar a referenciar aquelas pastas. Ou seja: miniatura de sessão
//! anterior é lixo **provado**, não suspeita. E, como nada nunca apagava nada,
//! elas se acumulam de sessão em sessão pra sempre.
//!
//! Isso dá o critério: *criada antes desta sessão começar*. Mas confiar só no
//! relógio seria repetir, de outro jeito, o erro do caminho obsoleto — um
//! relógio atrasado (ou um fuso/ajuste de horário no meio do uso) faria a pasta
//! da sessão ATUAL parecer velha, e a limpeza apagaria as miniaturas que estão
//! na tela naquele instante. Por isso são **duas razões independentes, e as
//! duas têm que concordar**:
//!
//! 1. a pasta é mais antiga que o início desta sessão; **e**
//! 2. nenhum id vivo (o front manda os que estão em uso) casa com ela.
//!
//! Discordância nenhuma apaga: na dúvida, fica. Ficar custa disco; sumir custa
//! a miniatura da tela.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use tauri::Manager;

/// Instante em que este processo subiu. Guardado no state do Tauri.
pub struct StartedAt(pub SystemTime);

impl Default for StartedAt {
    fn default() -> Self {
        StartedAt(SystemTime::now())
    }
}

#[derive(serde::Serialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Freed {
    pub files: u64,
    pub bytes: u64,
}

pub fn tree_stats(dir: &Path) -> (u64, u64) {
    let mut bytes = 0u64;
    let mut files = 0u64;
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let (b, f) = tree_stats(&path);
                bytes += b;
                files += f;
            } else if let Ok(meta) = entry.metadata() {
                bytes += meta.len();
                files += 1;
            }
        }
    }
    (bytes, files)
}

fn remove_tree(dir: &Path) -> Freed {
    let (bytes, files) = tree_stats(dir);
    if std::fs::remove_dir_all(dir).is_ok() {
        Freed { files, bytes }
    } else {
        Freed::default()
    }
}

fn remove_file(path: &Path) -> Freed {
    let bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if std::fs::remove_file(path).is_ok() {
        Freed { files: 1, bytes }
    } else {
        Freed::default()
    }
}

/// Instante da última escrita. `None` = não deu pra saber — e "não deu pra
/// saber" NUNCA vira "pode apagar" (ver `is_leftover`).
fn touched_at(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok()?.modified().ok()
}

/// O nome da pasta de miniaturas é `<id>-cover`, `<id>-strip` ou `<id>-tl`.
/// Um id vivo casa se for prefixo do nome — assim os três sufixos do mesmo
/// arquivo são protegidos de uma vez, sem a UI precisar saber deles.
fn matches_live(name: &str, live_ids: &[String]) -> bool {
    live_ids.iter().any(|id| !id.is_empty() && name.starts_with(id.as_str()))
}

/// É sobra de sessão anterior?
///
/// Só quando as DUAS razões concordam: mais antiga que o início da sessão E
/// sem id vivo casando. Metadado ilegível conta como "não sei", e não sei
/// significa fica.
pub fn is_leftover(
    name: &str,
    touched: Option<SystemTime>,
    started_at: SystemTime,
    live_ids: &[String],
) -> bool {
    let Some(t) = touched else {
        return false;
    };
    t < started_at && !matches_live(name, live_ids)
}

/// Pastas de `thumbs/` que sobraram de sessões anteriores.
pub fn leftover_thumbs(root: &Path, started_at: SystemTime, live_ids: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(root) {
        for entry in rd.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let name = dir.file_name().unwrap_or_default().to_string_lossy().into_owned();
            if is_leftover(&name, touched_at(&dir), started_at, live_ids) {
                out.push(dir);
            }
        }
    }
    out
}

/// Arquivos de `tmp/` que sobraram: listas do concat demuxer e paletas de GIF
/// de trabalhos que terminaram — ou que foram abortados no meio, que é o caso
/// que nunca limpava nada. Cada um serve a UMA execução do ffmpeg que vem logo
/// em seguida, então tudo que é anterior a esta sessão já cumpriu (ou perdeu) o
/// seu papel.
pub fn leftover_tmp(root: &Path, started_at: SystemTime, live_ids: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(root) {
        for entry in rd.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
            if is_leftover(&name, touched_at(&path), started_at, live_ids) {
                out.push(path);
            }
        }
    }
    out
}

fn sum_dirs(dirs: &[PathBuf]) -> u64 {
    dirs.iter().map(|p| tree_stats(p).0).sum()
}

fn sum_files(files: &[PathBuf]) -> u64 {
    files.iter().filter_map(|p| std::fs::metadata(p).ok()).map(|m| m.len()).sum()
}

// ---------------------------------------------------------------------------
// comandos
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    dir: String,
    thumbs_bytes: u64,
    thumbs_files: u64,
    /// Quantas pastas de miniatura existem no total.
    thumbs_dirs: u64,
    old_thumbs_bytes: u64,
    old_thumbs_dirs: u64,
    tmp_bytes: u64,
    tmp_files: u64,
    old_tmp_bytes: u64,
    old_tmp_files: u64,
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("app_data indisponível: {}", e))
}

/// Mede tudo. `liveIds` são os ids que o front está usando AGORA — o segundo
/// portão que impede a limpeza de encostar na sessão atual.
#[tauri::command(async)]
pub fn storage_info(
    app: tauri::AppHandle,
    started: tauri::State<'_, StartedAt>,
    live_ids: Vec<String>,
) -> Result<StorageInfo, String> {
    let dir = data_dir(&app)?;
    let thumbs = dir.join("thumbs");
    let tmp = dir.join("tmp");

    let (thumbs_bytes, thumbs_files) = tree_stats(&thumbs);
    let (tmp_bytes, tmp_files) = tree_stats(&tmp);
    let thumbs_dirs = std::fs::read_dir(&thumbs)
        .map(|rd| rd.flatten().filter(|e| e.path().is_dir()).count() as u64)
        .unwrap_or(0);

    let old_thumbs = leftover_thumbs(&thumbs, started.0, &live_ids);
    let old_tmp = leftover_tmp(&tmp, started.0, &live_ids);

    Ok(StorageInfo {
        dir: dir.to_string_lossy().into_owned(),
        thumbs_bytes,
        thumbs_files,
        thumbs_dirs,
        old_thumbs_bytes: sum_dirs(&old_thumbs),
        old_thumbs_dirs: old_thumbs.len() as u64,
        tmp_bytes,
        tmp_files,
        old_tmp_bytes: sum_files(&old_tmp),
        old_tmp_files: old_tmp.len() as u64,
    })
}

/// Miniaturas de sessões anteriores. As da sessão atual ficam.
#[tauri::command(async)]
pub fn storage_clear_old_thumbs(
    app: tauri::AppHandle,
    started: tauri::State<'_, StartedAt>,
    live_ids: Vec<String>,
) -> Result<Freed, String> {
    let root = data_dir(&app)?.join("thumbs");
    let mut total = Freed::default();
    for d in leftover_thumbs(&root, started.0, &live_ids) {
        let f = remove_tree(&d);
        total.files += f.files;
        total.bytes += f.bytes;
    }
    Ok(total)
}

/// Intermediários do ffmpeg de sessões anteriores (inclusive os de trabalho
/// abortado, que nunca eram limpos).
#[tauri::command(async)]
pub fn storage_clear_old_tmp(
    app: tauri::AppHandle,
    started: tauri::State<'_, StartedAt>,
    live_ids: Vec<String>,
) -> Result<Freed, String> {
    let root = data_dir(&app)?.join("tmp");
    let mut total = Freed::default();
    for f in leftover_tmp(&root, started.0, &live_ids) {
        let r = remove_file(&f);
        total.files += r.files;
        total.bytes += r.bytes;
    }
    Ok(total)
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;

    static SEQ: AtomicU32 = AtomicU32::new(0);

    fn tmp_dir(tag: &str) -> PathBuf {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("localmedia-storage-{tag}-{n}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const AGORA: Duration = Duration::from_secs(1_800_000_000);

    fn t(secs: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + AGORA + Duration::from_secs(secs)
    }

    /// A sessão começou em t(100). Tudo antes é de sessão anterior.
    const INICIO: u64 = 100;

    #[test]
    fn sessao_anterior_e_lixo_sessao_atual_nao() {
        let vivos = vec!["abc123".to_string()];
        // Velha e sem id vivo: as duas razões concordam.
        assert!(is_leftover("xyz999-cover", Some(t(50)), t(INICIO), &vivos));
        // Escrita depois do início: é desta sessão.
        assert!(!is_leftover("xyz999-cover", Some(t(150)), t(INICIO), &vivos));
        // Exatamente no início não é "antes".
        assert!(!is_leftover("xyz999-cover", Some(t(INICIO)), t(INICIO), &vivos));
    }

    /// O portão que existe justamente pra o relógio não mandar sozinho: uma
    /// pasta que PARECE velha mas tem id vivo não é tocada. É o caso do
    /// relógio atrasado/ajuste de horário no meio do uso — sem este portão a
    /// limpeza apagaria a miniatura que está na tela naquele instante.
    #[test]
    fn id_vivo_protege_mesmo_com_relogio_mentindo() {
        let vivos = vec!["abc123".to_string()];
        assert!(!is_leftover("abc123-cover", Some(t(1)), t(INICIO), &vivos));
        assert!(!is_leftover("abc123-strip", Some(t(1)), t(INICIO), &vivos));
        assert!(!is_leftover("abc123-tl", Some(t(1)), t(INICIO), &vivos));
        // …e o vizinho de nome parecido, que NÃO é o mesmo id, segue sendo lixo.
        assert!(is_leftover("abc124-cover", Some(t(1)), t(INICIO), &vivos));
    }

    /// "Não deu pra ler o metadado" nunca vira "pode apagar".
    #[test]
    fn sem_data_nao_apaga() {
        assert!(!is_leftover("qualquer", None, t(INICIO), &[]));
    }

    /// Id vazio (o front mandando lixo) não pode virar curinga que protege
    /// tudo — nem, ao contrário, casar com tudo.
    #[test]
    fn id_vazio_nao_vira_curinga() {
        let vivos = vec!["".to_string()];
        assert!(is_leftover("xyz-cover", Some(t(1)), t(INICIO), &vivos));
    }

    #[test]
    fn limpeza_de_thumbs_preserva_a_sessao_atual() {
        let root = tmp_dir("thumbs");
        // Pasta da sessão atual (escrita agora) com id vivo.
        let viva = root.join("vivo1-cover");
        std::fs::create_dir_all(&viva).unwrap();
        std::fs::write(viva.join("0.jpg"), vec![b'x'; 400]).unwrap();
        // Pasta de sessão anterior: forçada pro passado.
        let velha = root.join("morto9-strip");
        std::fs::create_dir_all(&velha).unwrap();
        std::fs::write(velha.join("0.jpg"), vec![b'x'; 300]).unwrap();

        // O "início da sessão" é daqui a um segundo: tudo que existe é passado…
        let inicio = SystemTime::now() + Duration::from_secs(1);
        // …mas o id vivo salva a pasta que está em uso.
        let alvo = leftover_thumbs(&root, inicio, &["vivo1".to_string()]);
        assert_eq!(alvo.len(), 1);
        assert!(alvo[0].ends_with("morto9-strip"));

        let mut freed = Freed::default();
        for d in &alvo {
            let f = remove_tree(d);
            freed.files += f.files;
            freed.bytes += f.bytes;
        }
        assert_eq!(freed, Freed { files: 1, bytes: 300 });
        assert_eq!(tree_stats(&viva), (400, 1), "miniatura em uso foi apagada");
        assert!(!velha.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn limpeza_de_tmp_preserva_o_trabalho_em_andamento() {
        let root = tmp_dir("tmp");
        std::fs::write(root.join("job7-palette.png"), vec![b'x'; 900]).unwrap();
        std::fs::write(root.join("abandonado.txt"), vec![b'x'; 100]).unwrap();
        // Subpasta não entra (o tmp é plano; recursar convidaria a apagar o que
        // não é nosso).
        std::fs::create_dir_all(root.join("sub")).unwrap();

        let inicio = SystemTime::now() + Duration::from_secs(1);
        let alvo = leftover_tmp(&root, inicio, &["job7".to_string()]);
        assert_eq!(alvo.len(), 1);
        assert!(alvo[0].ends_with("abandonado.txt"));

        let freed = remove_file(&alvo[0]);
        assert_eq!(freed, Freed { files: 1, bytes: 100 });
        assert!(root.join("job7-palette.png").exists(), "paleta do trabalho em curso sumiu");
        assert!(root.join("sub").exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Sem nenhum id vivo (app recém-aberto, nada carregado) tudo que é antigo
    /// sai — que é exatamente o estado em que o painel mais rende.
    #[test]
    fn sem_ids_vivos_tudo_que_e_antigo_sai() {
        let root = tmp_dir("sem-vivos");
        for n in ["a-cover", "b-strip", "c-tl"] {
            let d = root.join(n);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("0.jpg"), vec![b'x'; 10]).unwrap();
        }
        let inicio = SystemTime::now() + Duration::from_secs(1);
        assert_eq!(leftover_thumbs(&root, inicio, &[]).len(), 3);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn pastas_inexistentes_nao_sao_erro() {
        let nada = std::env::temp_dir().join("localmedia-nao-existe-mesmo");
        let agora = SystemTime::now();
        assert_eq!(tree_stats(&nada), (0, 0));
        assert!(leftover_thumbs(&nada, agora, &[]).is_empty());
        assert!(leftover_tmp(&nada, agora, &[]).is_empty());
        assert_eq!(remove_file(&nada.join("x")), Freed::default());
    }

    #[test]
    fn limpezas_sao_idempotentes() {
        let root = tmp_dir("idempotente");
        let d = root.join("velho-cover");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("0.jpg"), vec![b'x'; 50]).unwrap();
        let inicio = SystemTime::now() + Duration::from_secs(1);

        let alvo = leftover_thumbs(&root, inicio, &[]);
        assert_eq!(remove_tree(&alvo[0]), Freed { files: 1, bytes: 50 });
        assert!(leftover_thumbs(&root, inicio, &[]).is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }
}
