// Tela do editor: preview + propriedades em cima, barra de ferramentas e
// timeline embaixo. Atalhos: espaço = play/pause, S = dividir, Delete =
// remover, Shift+Delete = remover e fechar buraco (ripple), Ctrl+C/V =
// copiar/colar no cursor, Ctrl+D = duplicar, ←/→ = mover cursor (Shift = 1s),
// Home/End = início/fim, Ctrl+Z / Ctrl+Shift+Z (ou Ctrl+Y) = desfazer/refazer.

import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { projectDurMs } from "../../lib/editor/model";
import { t } from "../../lib/i18n";
import { fmtCut } from "../../lib/time";
import { IMAGE_EXTENSIONS, MEDIA_EXTENSIONS } from "../../lib/types";
import { useEditor } from "../../state/editor";
import { useUi } from "../../state/ui";
import ClipProps from "./ClipProps";
import HelpModal from "./HelpModal";
import PreviewStage from "./PreviewStage";
import Timeline from "./Timeline";

export default function EditorView() {
  const clips = useEditor((s) => s.clips);
  const playing = useEditor((s) => s.playing);
  const playheadMs = useEditor((s) => s.playheadMs);
  const vTracks = useEditor((s) => s.vTracks);
  const aTracks = useEditor((s) => s.aTracks);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const snapOn = useEditor((s) => s.snapOn);
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
    toggleSnap,
    addTrack,
    removeTrack,
    clearProject,
    exportProject,
    saveProjectAs,
    openProjectFile,
  } = useEditor.getState();

  const durMs = projectDurMs(clips);

  async function pickMedia() {
    const picked = await open({
      multiple: true,
      title: t("topbar.addMediaProject"),
      filters: [
        { name: t("topbar.filterMediaImages"), extensions: [...MEDIA_EXTENSIONS, ...IMAGE_EXTENSIONS] },
      ],
    }).catch(() => null);
    if (!picked) return;
    void addMediaPaths(Array.isArray(picked) ? picked : [picked]);
  }

  function zoomFit() {
    const viewPx = Math.max(300, window.innerWidth - 420);
    const secs = Math.max(1, projectDurMs(useEditor.getState().clips) / 1000);
    setZoom(viewPx / secs);
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
      } else if ((e.key === "Delete" || e.key === "Backspace") && e.shiftKey) {
        s.rippleRemoveSelected();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        s.removeSelected();
      } else if (e.key.toLowerCase() === "s" && !e.ctrlKey) {
        s.splitAtPlayhead();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = (e.shiftKey ? 1000 : 100) * (e.key === "ArrowLeft" ? -1 : 1);
        s.setPlaying(false);
        s.setPlayhead(s.playheadMs + step);
      } else if (e.key === "?" || e.key === "F1") {
        e.preventDefault();
        useUi.getState().setHelpOpen(!useUi.getState().helpOpen);
      } else if (e.key === "Escape") {
        if (useUi.getState().helpOpen) useUi.getState().setHelpOpen(false);
        else s.select("");
      } else if (e.key === "Home") {
        e.preventDefault();
        s.setPlaying(false);
        s.setPlayhead(0);
      } else if (e.key === "End") {
        e.preventDefault();
        s.setPlaying(false);
        s.setPlayhead(projectDurMs(s.clips));
      } else if (e.ctrlKey && e.key.toLowerCase() === "c") {
        s.copySelected();
      } else if (e.ctrlKey && e.key.toLowerCase() === "v") {
        s.pasteAtPlayhead();
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
          ＋ {t("ed.media")}
        </button>
        <button className="btn small" onClick={addTextClip} title={t("ed.textTitle")}>
          ＋ {t("ed.text")}
        </button>
        <button
          className="btn small"
          onClick={() => setPlaying(!playing)}
          disabled={clips.length === 0}
          title={t("ed.playTitle")}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <span className="editor-time">
          {fmtCut(playheadMs)} / {fmtCut(durMs)}
        </span>
        <span className="toolbar-sep" />
        <button className="btn small" onClick={splitAtPlayhead} title={t("ed.splitTitle")}>
          ✂ {t("ed.split")}
        </button>
        <button className="btn small" onClick={removeSelected} title={t("ed.removeTitle")}>
          🗑
        </button>
        <button className="btn small" onClick={undo} disabled={undoStack.length === 0} title={t("ed.undoTitle")}>
          ↩
        </button>
        <button className="btn small" onClick={redo} disabled={redoStack.length === 0} title={t("ed.redoTitle")}>
          ↪
        </button>
        <span className="toolbar-sep" />
        <button className="btn small" onClick={() => addTrack("video")} disabled={vTracks.length >= 4} title={t("ed.addVideoTrackTitle")}>
          ＋ {t("ed.layer")}
        </button>
        <button className="btn small" onClick={() => removeTrack("video")} disabled={vTracks.length <= 1} title={t("ed.removeVideoTrackTitle")}>
          −
        </button>
        <button className="btn small" onClick={() => addTrack("audio")} disabled={aTracks.length >= 4} title={t("ed.addAudioTrackTitle")}>
          ＋ {t("ed.audioTrack")}
        </button>
        <button className="btn small" onClick={() => removeTrack("audio")} disabled={aTracks.length <= 1} title={t("ed.removeAudioTrackTitle")}>
          −
        </button>
        <span className="toolbar-sep" />
        <button
          className={`btn small ${snapOn ? "primary" : ""}`}
          onClick={toggleSnap}
          title={t("ed.snapTitle")}
        >
          🧲
        </button>
        <button className="btn small" onClick={() => setZoom(pxPerSec * 0.8)} title={t("ed.zoomOutTitle")}>
          −
        </button>
        <button className="btn small" onClick={() => setZoom(pxPerSec * 1.25)}>
          ＋
        </button>
        <button className="btn small" onClick={zoomFit} disabled={clips.length === 0} title={t("ed.zoomFitTitle")}>
          ⤢
        </button>
        <span className="toolbar-spacer" />
        <button
          className="btn small"
          onClick={() => useUi.getState().setHelpOpen(true)}
          title={t("ed.helpTitle")}
        >
          ?
        </button>
        <button className="btn small" onClick={() => void openProjectFile()} title={t("ed.openProjectTitle")}>
          📂
        </button>
        <button
          className="btn small"
          onClick={() => void saveProjectAs()}
          disabled={clips.length === 0}
          title={t("ed.saveProjectTitle")}
        >
          💾
        </button>
        <button className="btn ghost small" onClick={clearProject} disabled={clips.length === 0}>
          {t("ed.clear")}
        </button>
        <button className="btn primary small" onClick={() => void exportProject()} disabled={clips.length === 0}>
          {t("ed.export")}
        </button>
      </div>

      {clips.length === 0 ? (
        <div className="editor-empty" onClick={() => void pickMedia()}>
          <div className="drop-icon">🎞️</div>
          <p>{t("ed.emptyText")}</p>
          <p className="editor-frozen-note">{t("ed.frozenNote")}</p>
        </div>
      ) : (
        <Timeline />
      )}
      <HelpModal />
    </div>
  );
}
