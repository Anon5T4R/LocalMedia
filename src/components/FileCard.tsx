import { convertFileSrc } from "@tauri-apps/api/core";
import { availableActions } from "../lib/capabilities";
import { t } from "../lib/i18n";
import { fmtBytes, fmtDur } from "../lib/time";
import type { MediaFile } from "../lib/types";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

export default function FileCard({ file }: { file: MediaFile }) {
  const removeFile = useStore((s) => s.removeFile);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const openTask = useUi((s) => s.openTask);
  const { info } = file;

  const available = availableActions(info);

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
          {available.map((a) => (
            <button key={a.id} className="btn small" onClick={() => openTask(file.id, a.id)}>
              {t(a.label)}
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
