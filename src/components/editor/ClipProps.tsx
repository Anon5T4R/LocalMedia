// Painel lateral do editor: propriedades do clipe selecionado (volume, mudo,
// velocidade, fades, camada, rotação, texto, vínculo) ou, sem seleção, os
// ajustes do projeto (resolução/fps/qualidade da exportação).

import { clipDurMs, clipEndMs, isFreeSource } from "../../lib/editor/model";
import { fmtCut } from "../../lib/time";
import { useEditor } from "../../state/editor";

const RESOLUTIONS: [string, number, number][] = [
  ["1080p (1920×1080)", 1920, 1080],
  ["720p (1280×720)", 1280, 720],
  ["480p (854×480)", 854, 480],
  ["Vertical (1080×1920)", 1080, 1920],
  ["Quadrado (1080×1080)", 1080, 1080],
];

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const QUALITIES: [number, string][] = [
  [18, "Máxima (arquivo maior)"],
  [20, "Alta (padrão)"],
  [26, "Compacta (arquivo menor)"],
];

export default function ClipProps() {
  const clips = useEditor((s) => s.clips);
  const selectedId = useEditor((s) => s.selectedId);
  const project = useEditor((s) => s.project);
  const exportCrf = useEditor((s) => s.exportCrf);
  const setProject = useEditor((s) => s.setProject);
  const setExportCrf = useEditor((s) => s.setExportCrf);
  const setGain = useEditor((s) => s.setGain);
  const toggleMute = useEditor((s) => s.toggleMute);
  const setFit = useEditor((s) => s.setFit);
  const setRect = useEditor((s) => s.setRect);
  const setSpeed = useEditor((s) => s.setSpeed);
  const setFade = useEditor((s) => s.setFade);
  const setOpacity = useEditor((s) => s.setOpacity);
  const setRotation = useEditor((s) => s.setRotation);
  const toggleFlipH = useEditor((s) => s.toggleFlipH);
  const setTextProps = useEditor((s) => s.setTextProps);
  const trim = useEditor((s) => s.trim);
  const unlinkSelected = useEditor((s) => s.unlinkSelected);
  const removeSelected = useEditor((s) => s.removeSelected);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
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
        <label className="prop-row">
          Qualidade
          <select value={exportCrf} onChange={(e) => setExportCrf(Number(e.target.value))}>
            {QUALITIES.map(([crf, label]) => (
              <option key={crf} value={crf}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="card-hint">
          Clique num clipe pra editar volume, velocidade, fades, posição da camada e vínculo.
          Vídeos com som entram como um par vinculado (🔗): desvincule pra recortar só o
          áudio ou só o vídeo. O botão <b>＋ Texto</b> põe títulos por cima do vídeo.
        </p>
      </aside>
    );
  }

  const kindLabel =
    clip.kind === "video"
      ? "vídeo"
      : clip.kind === "image"
        ? "imagem"
        : clip.kind === "text"
          ? "título"
          : "áudio";
  const isVisual = clip.kind === "video" || clip.kind === "image";

  return (
    <aside className="clip-props">
      <h3 title={clip.src.path || clip.text}>
        {clip.kind === "text" ? clip.text || "Título" : clip.src.name}
      </h3>
      <div className="prop-meta">
        <span className="chip">{kindLabel}</span>
        <span className="chip">
          {fmtCut(clip.startMs)} → {fmtCut(clipEndMs(clip))}
        </span>
        <span className="chip">dura {fmtCut(clipDurMs(clip))}</span>
        {clip.speed !== 1 && <span className="chip">{clip.speed}×</span>}
      </div>

      {clip.kind === "text" && (
        <>
          <label className="prop-row">
            Texto
            <input
              type="text"
              value={clip.text}
              onChange={(e) => setTextProps(clip.id, { text: e.target.value })}
            />
          </label>
          <label className="prop-row">
            Tamanho
            <input
              type="range"
              min={0.03}
              max={0.25}
              step={0.01}
              value={clip.textSize}
              onPointerDown={beginGesture}
              onChange={(e) => setTextProps(clip.id, { textSize: Number(e.target.value) })}
            />
            <b>{Math.round(clip.textSize * 100)}%</b>
          </label>
          <label className="prop-row">
            Cor
            <input
              type="color"
              value={clip.textColor}
              onChange={(e) => setTextProps(clip.id, { textColor: e.target.value })}
            />
            <label className="check-row" style={{ flex: 1 }}>
              <input
                type="checkbox"
                checked={clip.textBox}
                onChange={() => setTextProps(clip.id, { textBox: !clip.textBox })}
              />
              <span>Fundo</span>
            </label>
          </label>
          {(
            [
              ["X", "x"],
              ["Y", "y"],
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="prop-row">
              {label}
              <input
                type="range"
                min={0}
                max={1}
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

      {isVisual && (
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
          <label className="prop-row">
            Rotação
            <select
              value={clip.rotation}
              onChange={(e) => {
                beginGesture();
                setRotation(clip.id, Number(e.target.value) as 0 | 90 | 180 | 270);
              }}
            >
              <option value={0}>Sem rotação</option>
              <option value={90}>90° horário</option>
              <option value={180}>180°</option>
              <option value={270}>90° anti-horário</option>
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={clip.flipH}
              onChange={() => {
                beginGesture();
                toggleFlipH(clip.id);
              }}
            />
            <span>Espelhar na horizontal</span>
          </label>
        </>
      )}

      {(isVisual || clip.kind === "text") && (
        <label className="prop-row">
          Opacidade
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={clip.opacity}
            onPointerDown={beginGesture}
            onChange={(e) => setOpacity(clip.id, Number(e.target.value))}
          />
          <b>{Math.round(clip.opacity * 100)}%</b>
        </label>
      )}

      {(clip.kind === "video" || clip.kind === "audio") && (
        <label className="prop-row">
          Velocidade
          <select
            value={clip.speed}
            onChange={(e) => {
              beginGesture();
              setSpeed(clip.id, Number(e.target.value));
            }}
          >
            {SPEEDS.map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
            {!SPEEDS.includes(clip.speed) && <option value={clip.speed}>{clip.speed}×</option>}
          </select>
        </label>
      )}

      {clip.kind !== "text" && (
        <>
          <label className="prop-row">
            Fade in
            <input
              type="range"
              min={0}
              max={3000}
              step={100}
              value={clip.fadeInMs}
              onPointerDown={beginGesture}
              onChange={(e) => setFade(clip.id, { fadeInMs: Number(e.target.value) })}
            />
            <b>{(clip.fadeInMs / 1000).toFixed(1)}s</b>
          </label>
          <label className="prop-row">
            Fade out
            <input
              type="range"
              min={0}
              max={3000}
              step={100}
              value={clip.fadeOutMs}
              onPointerDown={beginGesture}
              onChange={(e) => setFade(clip.id, { fadeOutMs: Number(e.target.value) })}
            />
            <b>{(clip.fadeOutMs / 1000).toFixed(1)}s</b>
          </label>
        </>
      )}

      {isFreeSource(clip.kind) && (
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
          <button
            className="btn small"
            onClick={unlinkSelected}
            title="Separar áudio e vídeo pra editar cada um sozinho"
          >
            🔗 Desvincular
          </button>
        )}
        <button className="btn small" onClick={duplicateSelected} title="Ctrl+D">
          ⧉ Duplicar
        </button>
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
