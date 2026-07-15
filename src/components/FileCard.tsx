import { convertFileSrc } from "@tauri-apps/api/core";
import { t, type MessageKey } from "../lib/i18n";
import { fmtBytes, fmtDur } from "../lib/time";
import type { MediaFile } from "../lib/types";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

const ACTIONS: [string, MessageKey][] = [
  ["converter", "action.convert"],
  ["comprimir", "action.compress"],
  ["cortar", "action.cut"],
  ["gif", "action.gif"],
  ["faixas", "action.tracks"],
  ["ajustes", "action.adjust"],
];

export default function FileCard({ file }: { file: MediaFile }) {
  const removeFile = useStore((s) => s.removeFile);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const openTask = useUi((s) => s.openTask);
  const { info } = file;

  const available = ACTIONS.filter(([tab]) => {
    if (!info.video && (tab === "comprimir" || tab === "gif")) return false;
    if (tab === "faixas" && info.audio.length + info.subs.length < 2) return false;
    return true;
  });

  return (
    <div className={`file-card ${file.selected ? "selected" : ""}`}>
      <div className="file-thumb" onClick={() => toggleSelect(file.id)}>
        {file.thumb ? (
          <img src={convertFileSrc(file.thumb)} alt="" />
        ) : (
          <span className="file-thumb-icon">{info.video ? "🎬" : "🎵"}</span>
        )}
        <input
          type="checkbox"
          className="file-check"
          checked={file.selected}
          onChange={() => toggleSelect(file.id)}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div className="file-body">
        <div className="file-name" title={info.path}>
          {info.name}
        </div>
        <div className="file-meta">
          <span>{fmtDur(info.durationMs)}</span>
          <span>{fmtBytes(info.sizeBytes)}</span>
          {info.video && (
            <span>
              {info.video.width}×{info.video.height} {info.video.codec}
            </span>
          )}
          {info.audio[0] && (
            <span>
              {info.audio[0].codec}
              {info.audio.length > 1 ? ` ${t("filecard.tracksCount", { n: info.audio.length })}` : ""}
            </span>
          )}
        </div>
        <div className="file-actions">
          {available.map(([tab, label]) => (
            <button key={tab} className="btn small" onClick={() => openTask(file.id, tab)}>
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <button className="file-del icon-btn" title={t("filecard.removeTitle")} onClick={() => removeFile(file.id)}>
        ✕
      </button>
    </div>
  );
}
