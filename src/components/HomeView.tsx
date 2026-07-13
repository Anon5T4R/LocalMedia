import { open, save } from "@tauri-apps/plugin-dialog";
import * as be from "../lib/backend";
import { buildConcat, concatCompatible } from "../lib/presets";
import { MEDIA_EXTENSIONS } from "../lib/types";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";
import FileCard from "./FileCard";
import QueuePanel from "./QueuePanel";

export default function HomeView() {
  const files = useStore((s) => s.files);
  const addPaths = useStore((s) => s.addPaths);
  const clearSelection = useStore((s) => s.clearSelection);
  const enqueue = useStore((s) => s.enqueue);
  const runtimeOk = useStore((s) => s.runtimeOk);
  const toast = useUi((s) => s.toast);
  const setBatchOpen = useUi((s) => s.setBatchOpen);

  const selected = files.filter((f) => f.selected);

  async function pickFiles() {
    const picked = await open({
      multiple: true,
      title: "Abrir mídia",
      filters: [{ name: "Vídeo e áudio", extensions: MEDIA_EXTENSIONS }],
    }).catch(() => null);
    if (!picked) return;
    void addPaths(Array.isArray(picked) ? picked : [picked]);
  }

  async function joinSelected() {
    const infos = selected.map((f) => f.info);
    if (!concatCompatible(infos)) {
      toast(
        "error",
        "Pra juntar sem recodificar, os clipes precisam ter o mesmo formato e codecs. " +
          "Converta todos pro mesmo preset primeiro (ex.: MP4 web) e junte de novo.",
      );
      return;
    }
    const totalMs = infos.reduce((acc, i) => acc + i.durationMs, 0);
    const container = infos[0].container;
    const out = await save({
      title: "Salvar vídeo juntado",
      defaultPath: `juntado.${container}`,
      filters: [{ name: container.toUpperCase(), extensions: [container] }],
    }).catch(() => null);
    if (!out) return;
    try {
      const list = await be.concatList(
        Date.now().toString(36),
        infos.map((i) => i.path),
      );
      enqueue(buildConcat(list, container, totalMs), out);
      clearSelection();
    } catch (e) {
      toast("error", String(e));
    }
  }

  return (
    <div className="home">
      {!runtimeOk && (
        <div className="banner warn">
          Runtime de mídia ausente (ffmpeg). Em desenvolvimento, rode{" "}
          <code>scripts/fetch-ffmpeg</code>; no app instalado isso não deveria acontecer.
        </div>
      )}

      {files.length === 0 ? (
        <div className="empty-hero" onClick={pickFiles}>
          <div className="drop-icon">🎬</div>
          <h1>Converta, comprima e corte vídeo e áudio</h1>
          <p className="home-sub">
            Arraste arquivos pra cá (ou clique). Tudo roda na sua máquina com ffmpeg — nada de
            site de conversão.
          </p>
        </div>
      ) : (
        <>
          <div className="file-grid">
            {files.map((f) => (
              <FileCard key={f.id} file={f} />
            ))}
            <div className="file-card add-card" onClick={pickFiles}>
              <span className="drop-icon">＋</span>
              <span>Adicionar mais</span>
            </div>
          </div>

          {selected.length > 0 && (
            <div className="selection-bar">
              <span>
                {selected.length} selecionado{selected.length > 1 ? "s" : ""}
              </span>
              {selected.length >= 2 && (
                <button className="btn primary small" onClick={() => void joinSelected()}>
                  Juntar clipes (sem recodificar)
                </button>
              )}
              <button className="btn small" onClick={() => setBatchOpen(true)}>
                Converter em lote…
              </button>
              <button className="btn ghost small" onClick={clearSelection}>
                Limpar seleção
              </button>
            </div>
          )}
        </>
      )}

      <QueuePanel />
    </div>
  );
}
