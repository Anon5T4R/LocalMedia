// Painel lateral do editor: propriedades do clipe selecionado (volume, mudo,
// posição da camada, duração de imagem, vínculo) ou, sem seleção, os ajustes
// do projeto (resolução/fps).

import { clipDurMs, clipEndMs } from "../../lib/editor/model";
import { fmtCut } from "../../lib/time";
import { useEditor } from "../../state/editor";

const RESOLUTIONS: [string, number, number][] = [
  ["1080p (1920×1080)", 1920, 1080],
  ["720p (1280×720)", 1280, 720],
  ["480p (854×480)", 854, 480],
  ["Vertical (1080×1920)", 1080, 1920],
  ["Quadrado (1080×1080)", 1080, 1080],
];

export default function ClipProps() {
  const clips = useEditor((s) => s.clips);
  const selectedId = useEditor((s) => s.selectedId);
  const project = useEditor((s) => s.project);
  const setProject = useEditor((s) => s.setProject);
  const setGain = useEditor((s) => s.setGain);
  const toggleMute = useEditor((s) => s.toggleMute);
  const setFit = useEditor((s) => s.setFit);
  const setRect = useEditor((s) => s.setRect);
  const trim = useEditor((s) => s.trim);
  const unlinkSelected = useEditor((s) => s.unlinkSelected);
  const removeSelected = useEditor((s) => s.removeSelected);
  const beginGesture = useEditor((s) => s.beginGesture);

  const clip = clips.find((c) => c.id === selectedId);

  if (!clip) {
    const resValue = `${project.width}x${project.height}`;
    return (
      <aside className="clip-props">
        <h3>Projeto</h3>
        <label className="prop-row">
          Resolução
          <select
            value={resValue}
            onChange={(e) => {
              const [w, h] = e.target.value.split("x").map(Number);
              setProject({ width: w, height: h });
            }}
          >
            {!RESOLUTIONS.some(([, w, h]) => `${w}x${h}` === resValue) && (
              <option value={resValue}>
                Do 1º vídeo ({project.width}×{project.height})
              </option>
            )}
            {RESOLUTIONS.map(([label, w, h]) => (
              <option key={label} value={`${w}x${h}`}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="prop-row">
          FPS
          <select value={project.fps} onChange={(e) => setProject({ fps: Number(e.target.value) })}>
            {[24, 25, 30, 60].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <p className="card-hint">
          Clique num clipe pra editar volume, posição da camada e vínculo. Vídeos com som
          entram como um par vinculado (🔗): desvincule pra recortar só o áudio ou só o
          vídeo.
        </p>
      </aside>
    );
  }

  const kindLabel =
    clip.kind === "video" ? "vídeo" : clip.kind === "image" ? "imagem" : "áudio";

  return (
    <aside className="clip-props">
      <h3 title={clip.src.path}>{clip.src.name}</h3>
      <div className="prop-meta">
        <span className="chip">{kindLabel}</span>
        <span className="chip">
          {fmtCut(clip.startMs)} → {fmtCut(clipEndMs(clip))}
        </span>
        <span className="chip">dura {fmtCut(clipDurMs(clip))}</span>
      </div>

      {clip.kind === "audio" && (
        <>
          <label className="prop-row">
            Volume
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={clip.gain}
              onPointerDown={beginGesture}
              onChange={(e) => setGain(clip.id, Number(e.target.value))}
            />
            <b>{Math.round(clip.gain * 100)}%</b>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={clip.muted}
              onChange={() => {
                beginGesture();
                toggleMute(clip.id);
              }}
            />
            <span>Mudo (fica fora da exportação)</span>
          </label>
        </>
      )}

      {clip.kind !== "audio" && (
        <>
          <label className="prop-row">
            Enquadr.
            <select
              value={clip.fit}
              onChange={(e) => {
                beginGesture();
                setFit(clip.id, e.target.value as "cheia" | "custom");
              }}
            >
              <option value="cheia">Tela cheia</option>
              <option value="custom">Camada (posição livre)</option>
            </select>
          </label>
          {clip.fit === "custom" && (
            <>
              {(
                [
                  ["Largura", "w", 0.05, 1],
                  ["X", "x", 0, 1],
                  ["Y", "y", 0, 1],
                ] as const
              ).map(([label, key, min, max]) => (
                <label key={key} className="prop-row">
                  {label}
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={0.01}
                    value={clip[key]}
                    onPointerDown={beginGesture}
                    onChange={(e) => setRect(clip.id, { [key]: Number(e.target.value) })}
                  />
                  <b>{Math.round(clip[key] * 100)}%</b>
                </label>
              ))}
            </>
          )}
        </>
      )}

      {clip.kind === "image" && (
        <label className="prop-row">
          Duração (s)
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={Math.round(clipDurMs(clip) / 100) / 10}
            onChange={(e) => {
              const secs = Number(e.target.value);
              if (!Number.isFinite(secs) || secs <= 0) return;
              beginGesture();
              trim(clip.id, "out", clip.startMs + secs * 1000);
            }}
          />
        </label>
      )}

      <div className="prop-actions">
        {clip.linkId && (
          <button className="btn small" onClick={unlinkSelected} title="Separar áudio e vídeo pra editar cada um sozinho">
            🔗 Desvincular
          </button>
        )}
        <button className="btn small" onClick={removeSelected}>
          🗑 Remover
        </button>
      </div>
      {clip.linkId && (
        <p className="card-hint">
          Este clipe está vinculado ao par de {clip.kind === "audio" ? "vídeo" : "áudio"}:
          mover um move o outro. Desvincule pra cortar trechos só do áudio ou só do vídeo.
        </p>
      )}
    </aside>
  );
}
