// Tela do editor: preview + propriedades em cima, barra de ferramentas e
// timeline embaixo. Atalhos: espaço = play/pause, S = dividir, Delete =
// remover, Ctrl+Z / Ctrl+Shift+Z (ou Ctrl+Y) = desfazer/refazer.

import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { projectDurMs } from "../../lib/editor/model";
import { fmtCut } from "../../lib/time";
import { IMAGE_EXTENSIONS, MEDIA_EXTENSIONS } from "../../lib/types";
import { useEditor } from "../../state/editor";
import ClipProps from "./ClipProps";
import PreviewStage from "./PreviewStage";
import Timeline from "./Timeline";

export default function EditorView() {
  const clips = useEditor((s) => s.clips);
  const playing = useEditor((s) => s.playing);
  const playheadMs = useEditor((s) => s.playheadMs);
  const videoTracks = useEditor((s) => s.videoTracks);
  const audioTracks = useEditor((s) => s.audioTracks);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const undoStack = useEditor((s) => s.undoStack);
  const redoStack = useEditor((s) => s.redoStack);

  const {
    addMediaPaths,
    setPlaying,
    splitAtPlayhead,
    removeSelected,
    addTextClip,
    undo,
    redo,
    setZoom,
    addTrack,
    clearProject,
    exportProject,
    saveProjectAs,
    openProjectFile,
  } = useEditor.getState();

  const durMs = projectDurMs(clips);

  async function pickMedia() {
    const picked = await open({
      multiple: true,
      title: "Adicionar mídia ao projeto",
      filters: [
        { name: "Mídia e imagens", extensions: [...MEDIA_EXTENSIONS, ...IMAGE_EXTENSIONS] },
      ],
    }).catch(() => null);
    if (!picked) return;
    void addMediaPaths(Array.isArray(picked) ? picked : [picked]);
  }

  // Atalhos de teclado (ignorando campos de texto).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      const s = useEditor.getState();
      if (e.code === "Space") {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        s.removeSelected();
      } else if (e.key.toLowerCase() === "s" && !e.ctrlKey) {
        s.splitAtPlayhead();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = (e.shiftKey ? 1000 : 100) * (e.key === "ArrowLeft" ? -1 : 1);
        s.setPlaying(false);
        s.setPlayhead(s.playheadMs + step);
      } else if (e.ctrlKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        s.duplicateSelected();
      } else if (e.ctrlKey && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if ((e.ctrlKey && e.key.toLowerCase() === "y") || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        s.redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="editor">
      <div className="editor-top">
        <PreviewStage />
        <ClipProps />
      </div>

      <div className="editor-toolbar">
        <button className="btn small" onClick={() => void pickMedia()}>
          ＋ Mídia
        </button>
        <button className="btn small" onClick={addTextClip} title="Título por cima do vídeo">
          ＋ Texto
        </button>
        <button
          className="btn small"
          onClick={() => setPlaying(!playing)}
          disabled={clips.length === 0}
          title="Espaço"
        >
          {playing ? "⏸" : "▶"}
        </button>
        <span className="editor-time">
          {fmtCut(playheadMs)} / {fmtCut(durMs)}
        </span>
        <span className="toolbar-sep" />
        <button className="btn small" onClick={splitAtPlayhead} title="S — divide o clipe selecionado no cursor">
          ✂ Dividir
        </button>
        <button className="btn small" onClick={removeSelected} title="Delete">
          🗑
        </button>
        <button className="btn small" onClick={undo} disabled={undoStack.length === 0} title="Ctrl+Z">
          ↩
        </button>
        <button className="btn small" onClick={redo} disabled={redoStack.length === 0} title="Ctrl+Shift+Z">
          ↪
        </button>
        <span className="toolbar-sep" />
        <button className="btn small" onClick={() => addTrack("video")} disabled={videoTracks >= 4}>
          ＋ Camada
        </button>
        <button className="btn small" onClick={() => addTrack("audio")} disabled={audioTracks >= 4}>
          ＋ Faixa de áudio
        </button>
        <span className="toolbar-sep" />
        <button className="btn small" onClick={() => setZoom(pxPerSec * 0.8)} title="Ctrl+roda também dá zoom">
          −
        </button>
        <button className="btn small" onClick={() => setZoom(pxPerSec * 1.25)}>
          ＋
        </button>
        <span className="toolbar-spacer" />
        <button className="btn small" onClick={() => void openProjectFile()} title="Abrir projeto salvo (.json)">
          📂
        </button>
        <button
          className="btn small"
          onClick={() => void saveProjectAs()}
          disabled={clips.length === 0}
          title="Salvar projeto (.json) — o rascunho também fica guardado sozinho"
        >
          💾
        </button>
        <button className="btn ghost small" onClick={clearProject} disabled={clips.length === 0}>
          Limpar
        </button>
        <button className="btn primary small" onClick={() => void exportProject()} disabled={clips.length === 0}>
          Exportar…
        </button>
      </div>

      {clips.length === 0 ? (
        <div className="editor-empty" onClick={() => void pickMedia()}>
          <div className="drop-icon">🎞️</div>
          <p>
            Arraste vídeos, áudios e imagens pra cá (ou clique). Vídeo com som entra como um
            par vinculado — desvincule pra recortar só o áudio ou só o vídeo. Camadas de
            vídeo (V2+) ficam por cima, como marca-d'água ou picture-in-picture.
          </p>
        </div>
      ) : (
        <Timeline />
      )}
    </div>
  );
}
