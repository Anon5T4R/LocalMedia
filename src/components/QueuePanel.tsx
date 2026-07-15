import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { t, type MessageKey } from "../lib/i18n";
import type { JobStatus } from "../lib/types";
import { useStore } from "../state/store";

const STATUS_LABEL: Record<JobStatus, MessageKey> = {
  waiting: "queue.status.waiting",
  running: "queue.status.running",
  done: "queue.status.done",
  error: "queue.status.error",
  cancelled: "queue.status.cancelled",
};

export default function QueuePanel() {
  const queue = useStore((s) => s.queue);
  const cancelJob = useStore((s) => s.cancelJob);
  const clearFinishedJobs = useStore((s) => s.clearFinishedJobs);

  if (queue.length === 0) return null;
  const hasFinished = queue.some((j) => j.status !== "waiting" && j.status !== "running");

  return (
    <div className="queue-panel">
      <div className="queue-head">
        <h2>{t("queue.title")}</h2>
        {hasFinished && (
          <button className="btn ghost small" onClick={clearFinishedJobs}>
            {t("queue.clearFinished")}
          </button>
        )}
      </div>
      {queue.map((j) => (
        <div key={j.id} className={`queue-item ${j.status}`}>
          <div className="queue-item-main">
            <div className="queue-item-name" title={j.outPath}>
              {j.label} → {j.outPath.replace(/\\/g, "/").split("/").pop()}
            </div>
            <div className="queue-item-status">
              {t(STATUS_LABEL[j.status])}
              {j.status === "running" &&
                ` — ${j.pct}%${j.speed ? ` (${j.speed})` : ""}${
                  j.steps.length > 1 ? ` · ${t("queue.step", { step: j.step + 1, total: j.steps.length })}` : ""
                }`}
              {j.error ? ` — ${j.error}` : ""}
            </div>
            {j.status === "running" && (
              <div className="progress">
                <div className="progress-fill" style={{ width: `${j.pct}%` }} />
              </div>
            )}
          </div>
          <div className="queue-item-actions">
            {j.status === "done" && (
              <button
                className="btn small"
                onClick={() => void revealItemInDir(j.outPath).catch(() => {})}
              >
                {t("queue.showInFolder")}
              </button>
            )}
            {(j.status === "waiting" || j.status === "running") && (
              <button className="btn small" onClick={() => cancelJob(j.id)}>
                {t("common.cancel")}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
