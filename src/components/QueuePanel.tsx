import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { JobStatus } from "../lib/types";
import { useStore } from "../state/store";

const STATUS_LABEL: Record<JobStatus, string> = {
  waiting: "na fila",
  running: "processando",
  done: "pronto",
  error: "erro",
  cancelled: "cancelado",
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
        <h2>Fila</h2>
        {hasFinished && (
          <button className="btn ghost small" onClick={clearFinishedJobs}>
            Limpar concluídos
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
              {STATUS_LABEL[j.status]}
              {j.status === "running" &&
                ` — ${j.pct}%${j.speed ? ` (${j.speed})` : ""}${
                  j.steps.length > 1 ? ` · passo ${j.step + 1}/${j.steps.length}` : ""
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
                Mostrar na pasta
              </button>
            )}
            {(j.status === "waiting" || j.status === "running") && (
              <button className="btn small" onClick={() => cancelJob(j.id)}>
                Cancelar
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
