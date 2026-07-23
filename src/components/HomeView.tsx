import { useEffect } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as be from "../lib/backend";
import { CAPABILITIES } from "../lib/capabilities";
import { t } from "../lib/i18n";
import { buildConcat, concatCompatible } from "../lib/presets";
import { MEDIA_EXTENSIONS } from "../lib/types";
import { useEditor } from "../state/editor";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";
import FileCard from "./FileCard";
import HomeHelpModal from "./HomeHelpModal";
import QueuePanel from "./QueuePanel";

export default function HomeView() {
  const files = useStore((s) => s.files);
  const addPaths = useStore((s) => s.addPaths);
  const clearSelection = useStore((s) => s.clearSelection);
  const enqueue = useStore((s) => s.enqueue);
  const runtimeOk = useStore((s) => s.runtimeOk);
  const toast = useUi((s) => s.toast);
  const setBatchOpen = useUi((s) => s.setBatchOpen);
  const setView = useUi((s) => s.setView);

  const selected = files.filter((f) => f.selected);

  // ? / F1 abrem a ajuda (mesmo padrão do editor; só uma view monta por vez).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
      if (e.key === "?" || e.key === "F1") {
        e.preventDefault();
        useUi.getState().setHelpOpen(!useUi.getState().helpOpen);
      } else if (e.key === "Escape" && useUi.getState().helpOpen) {
        useUi.getState().setHelpOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function pickFiles() {
    const picked = await open({
      multiple: true,
      title: t("topbar.openMedia"),
      filters: [{ name: t("topbar.filterVideoAudio"), extensions: MEDIA_EXTENSIONS }],
    }).catch(() => null);
    if (!picked) return;
    void addPaths(Array.isArray(picked) ? picked : [picked]);
  }

  async function joinSelected() {
    const infos = selected.map((f) => f.info);
    if (!concatCompatible(infos)) {
      toast("error", t("home.concatIncompatible"));
      return;
    }
    const totalMs = infos.reduce((acc, i) => acc + i.durationMs, 0);
    const container = infos[0].container;
    const out = await save({
      title: t("home.saveJoinedTitle"),
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
          {t("home.runtimeMissingPre")}{" "}
          <code>scripts/fetch-ffmpeg</code>
          {t("home.runtimeMissingPost")}
        </div>
      )}

      {files.length === 0 ? (
        <div className="empty-hero" onClick={pickFiles}>
          <div className="drop-icon">🎬</div>
          <h1>{t("home.emptyTitle")}</h1>
          <p className="home-sub">{t("home.emptySub")}</p>
          <div className="cap-grid">
            {CAPABILITIES.map((c) => (
              <span key={c.id} className="cap-chip" title={`${t(c.desc)} · ${t(c.how)}`}>
                <span className="cap-icon">{c.icon}</span>
                {t(c.label)}
              </span>
            ))}
          </div>
          <p className="empty-help-hint">{t("home.emptyHelpHint")}</p>
        </div>
      ) : (
        <>
          <div className="file-grid">
            {files.map((f) => (
              <FileCard key={f.id} file={f} />
            ))}
            <div className="file-card add-card" onClick={pickFiles}>
              <span className="drop-icon">＋</span>
              <span>{t("home.addMore")}</span>
            </div>
          </div>

          {selected.length > 0 && (
            <div className="selection-bar">
              <span>
                {selected.length > 1
                  ? t("home.selectedMany", { n: selected.length })
                  : t("home.selectedOne", { n: selected.length })}
              </span>
              {selected.length >= 2 && (
                <button className="btn primary small" onClick={() => void joinSelected()}>
                  {t("home.joinClips")}
                </button>
              )}
              <button className="btn small" onClick={() => setBatchOpen(true)}>
                {t("home.batchConvert")}
              </button>
              <button
                className="btn small"
                onClick={() => {
                  void useEditor.getState().addMediaPaths(selected.map((f) => f.info.path));
                  clearSelection();
                  setView("editor");
                }}
              >
                {t("home.openInEditor")}
              </button>
              <button className="btn ghost small" onClick={clearSelection}>
                {t("home.clearSelection")}
              </button>
            </div>
          )}
        </>
      )}

      <QueuePanel />
      <HomeHelpModal />
    </div>
  );
}
