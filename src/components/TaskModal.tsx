// Modal de operações de um arquivo: Converter / Comprimir / Cortar / GIF /
// Faixas / Ajustes. Cada aba monta um BuiltJob (lib/presets.ts) e o fluxo
// comum pede o destino num diálogo de salvar e enfileira.

import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as be from "../lib/backend";
import {
  buildBurnSubs,
  buildCompress,
  buildConvert,
  buildCut,
  buildGif,
  buildLoudnorm,
  buildMuxSubs,
  buildResize,
  buildRotate,
  buildTracks,
  estimateCompress,
  PRESETS,
  type BuiltJob,
  type PresetId,
  type Rotation,
} from "../lib/presets";
import { fmtBytes } from "../lib/time";
import { SUBTITLE_EXTENSIONS, type MediaFile } from "../lib/types";
import { suggestOut, useStore } from "../state/store";
import { useUi } from "../state/ui";

const TABS: [string, string][] = [
  ["converter", "Converter"],
  ["comprimir", "Comprimir"],
  ["cortar", "Cortar"],
  ["gif", "GIF"],
  ["legendas", "Legendas"],
  ["faixas", "Faixas"],
  ["ajustes", "Ajustes"],
];

import CutRange from "./CutRange";

export default function TaskModal() {
  const fileId = useUi((s) => s.taskFileId);
  const tab = useUi((s) => s.taskTab);
  const openTask = useUi((s) => s.openTask);
  const closeTask = useUi((s) => s.closeTask);
  const files = useStore((s) => s.files);
  const enqueue = useStore((s) => s.enqueue);

  const file = files.find((f) => f.id === fileId);
  if (!file) return null;

  const tabs = TABS.filter(([id]) => {
    if (!file.info.video && (id === "comprimir" || id === "gif" || id === "legendas")) return false;
    if (id === "faixas" && file.info.audio.length + file.info.subs.length < 2) return false;
    return true;
  });

  async function submit(built: BuiltJob) {
    if (!file) return;
    const suggested = suggestOut(file.info.path, built.suffix, built.ext);
    const out = await save({
      title: "Salvar como",
      defaultPath: suggested,
      filters: [{ name: built.ext.toUpperCase(), extensions: [built.ext] }],
    }).catch(() => null);
    if (!out) return;
    enqueue(built, out);
    closeTask();
  }

  return (
    <div className="modal-backdrop" onClick={closeTask}>
      <div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 title={file.info.path}>{file.info.name}</h2>
          <button className="icon-btn" onClick={closeTask}>
            ✕
          </button>
        </div>
        <div className="tabs">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              className={`tab ${tab === id ? "active" : ""}`}
              onClick={() => openTask(file.id, id)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "converter" && <ConvertTab file={file} onSubmit={submit} />}
        {tab === "comprimir" && <CompressTab file={file} onSubmit={submit} />}
        {tab === "cortar" && <CutTab file={file} onSubmit={submit} />}
        {tab === "gif" && <GifTab file={file} onSubmit={submit} />}
        {tab === "legendas" && <SubsTab file={file} onSubmit={submit} />}
        {tab === "faixas" && <TracksTab file={file} onSubmit={submit} />}
        {tab === "ajustes" && <AdjustTab file={file} onSubmit={submit} />}
      </div>
    </div>
  );
}

interface TabProps {
  file: MediaFile;
  onSubmit(built: BuiltJob): Promise<void>;
}

function ConvertTab({ file, onSubmit }: TabProps) {
  const [preset, setPreset] = useState<PresetId>(file.info.video ? "mp4-web" : "mp3");
  const options = PRESETS.filter((p) => (file.info.video ? true : p.audioOnly));
  return (
    <div className="tab-body">
      <div className="preset-list">
        {options.map((p) => (
          <label key={p.id} className={`preset-item ${preset === p.id ? "active" : ""}`}>
            <input
              type="radio"
              name="preset"
              checked={preset === p.id}
              onChange={() => setPreset(p.id)}
            />
            <div>
              <div className="preset-label">{p.label}</div>
              <div className="preset-hint">{p.hint}</div>
            </div>
          </label>
        ))}
      </div>
      <div className="tab-foot">
        <button className="btn primary" onClick={() => void onSubmit(buildConvert(file.info, preset))}>
          Converter…
        </button>
      </div>
    </div>
  );
}

function CompressTab({ file, onSubmit }: TabProps) {
  const [crf, setCrf] = useState(26);
  const est = estimateCompress(file.info.sizeBytes, crf);
  return (
    <div className="tab-body">
      <p className="card-hint">
        Recomprime em H.264 pelo fator de qualidade (CRF). Menor CRF = mais qualidade e mais
        tamanho. 23 é praticamente indistinguível; 28 já aperta bem.
      </p>
      <div className="crf-row">
        <span>18</span>
        <input
          type="range"
          min={18}
          max={34}
          value={crf}
          onChange={(e) => setCrf(Number(e.target.value))}
        />
        <span>34</span>
        <b className="crf-value">CRF {crf}</b>
      </div>
      <div className="card-hint">
        Tamanho estimado: <b>{fmtBytes(est)}</b> (estimativa grosseira — o resultado real
        depende do conteúdo). Original: {fmtBytes(file.info.sizeBytes)}.
      </div>
      <div className="tab-foot">
        <button className="btn primary" onClick={() => void onSubmit(buildCompress(file.info, crf))}>
          Comprimir…
        </button>
      </div>
    </div>
  );
}

function CutTab({ file, onSubmit }: TabProps) {
  const dur = file.info.durationMs;
  const [range, setRange] = useState<[number, number]>([0, dur]);
  const [copy, setCopy] = useState(true);
  return (
    <div className="tab-body">
      <CutRange
        file={file}
        startMs={range[0]}
        endMs={range[1]}
        onChange={(s, e) => setRange([s, e])}
      />
      <label className="check-row">
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
        <span>
          <b>Corte rápido (sem recodificar)</b> — instantâneo e sem perda; o início pode
          deslizar até o quadro-chave mais próximo. Desmarque pra corte exato (recodifica).
        </span>
      </label>
      <div className="tab-foot">
        <button
          className="btn primary"
          onClick={() => void onSubmit(buildCut(file.info, range[0], range[1], copy))}
        >
          Cortar…
        </button>
      </div>
    </div>
  );
}

function GifTab({ file, onSubmit }: TabProps) {
  const dur = file.info.durationMs;
  const [range, setRange] = useState<[number, number]>([0, Math.min(dur, 5000)]);
  const [fps, setFps] = useState(12);
  const [width, setWidth] = useState(480);
  const toast = useUi((s) => s.toast);

  async function submit() {
    if (range[1] - range[0] > 30_000) {
      toast("error", "GIF de mais de 30 s fica gigante — corte um trecho menor.");
      return;
    }
    const palette = await be.tmpPath(`${Date.now().toString(36)}-palette.png`);
    await onSubmit(buildGif(file.info, range[0], range[1], fps, width, palette));
  }

  return (
    <div className="tab-body">
      <CutRange
        file={file}
        startMs={range[0]}
        endMs={range[1]}
        onChange={(s, e) => setRange([s, e])}
      />
      <div className="gif-opts">
        <label>
          FPS
          <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
            {[8, 10, 12, 15, 20, 25].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          Largura
          <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            {[240, 320, 480, 640, 800].map((w) => (
              <option key={w} value={w}>
                {w}px
              </option>
            ))}
          </select>
        </label>
        <span className="card-hint">2 passes (paleta otimizada) — cores bem melhores.</span>
      </div>
      <div className="tab-foot">
        <button className="btn primary" onClick={() => void submit()}>
          Gerar GIF…
        </button>
      </div>
    </div>
  );
}

function SubsTab({ file, onSubmit }: TabProps) {
  const hasEmbedded = file.info.subs.length > 0;
  const [subPath, setSubPath] = useState("");
  const [source, setSource] = useState<"file" | "embedded">("file");
  const [embIndex, setEmbIndex] = useState(0);
  const [fontSize, setFontSize] = useState(0);
  const toast = useUi((s) => s.toast);

  const subName = subPath.split(/[\\/]/).pop() ?? "";

  async function pickSub() {
    const picked = await open({
      multiple: false,
      title: "Escolher arquivo de legenda",
      filters: [{ name: "Legendas", extensions: SUBTITLE_EXTENSIONS }],
    }).catch(() => null);
    if (picked && !Array.isArray(picked)) {
      setSubPath(picked);
      setSource("file");
    }
  }

  function burn() {
    if (source === "file" && !subPath) {
      toast("error", "Escolha um arquivo de legenda primeiro.");
      return;
    }
    const src =
      source === "embedded"
        ? ({ kind: "embedded", index: embIndex } as const)
        : ({ kind: "file", path: subPath } as const);
    void onSubmit(buildBurnSubs(file.info, src, fontSize));
  }

  return (
    <div className="tab-body">
      <p className="card-hint">
        <b>Queimar</b> grava a legenda nos quadros — aparece em qualquer lugar (WhatsApp,
        Instagram…), mas recodifica o vídeo. <b>Anexar como faixa</b> é instantâneo e dá pra
        ligar/desligar no player, só que nem todo app mostra. Dica: o LocalScribe gera o
        .srt da transcrição.
      </p>

      <div className="track-group">
        <div className="track-title">Origem da legenda</div>
        <label className="check-row">
          <input
            type="radio"
            name="subsrc"
            checked={source === "file"}
            onChange={() => setSource("file")}
          />
          <span>
            Arquivo (.srt, .vtt, .ass){" "}
            <button className="btn small" onClick={() => void pickSub()}>
              {subPath ? subName : "Escolher…"}
            </button>
          </span>
        </label>
        {hasEmbedded && (
          <label className="check-row">
            <input
              type="radio"
              name="subsrc"
              checked={source === "embedded"}
              onChange={() => setSource("embedded")}
            />
            <span>
              Embutida no vídeo{" "}
              <select
                value={embIndex}
                onChange={(e) => {
                  setEmbIndex(Number(e.target.value));
                  setSource("embedded");
                }}
              >
                {file.info.subs.map((s) => (
                  <option key={s.index} value={s.index}>
                    Legenda {s.index + 1} {s.lang && `(${s.lang})`} {s.title}
                  </option>
                ))}
              </select>
            </span>
          </label>
        )}
      </div>

      <div className="adjust-row">
        <div>
          <b>Queimar no vídeo</b>
          <div className="card-hint">tamanho da letra abaixo; recodifica (H.264)</div>
        </div>
        <select value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}>
          <option value={0}>Tamanho padrão</option>
          <option value={18}>Pequena</option>
          <option value={24}>Média</option>
          <option value={32}>Grande</option>
        </select>
        <button className="btn primary" onClick={burn}>
          Queimar…
        </button>
      </div>

      <div className="adjust-row">
        <div>
          <b>Anexar como faixa</b>
          <div className="card-hint">
            sem recodificar — só pra arquivo externo (a embutida já é uma faixa)
          </div>
        </div>
        <span />
        <button
          className="btn"
          disabled={!subPath}
          onClick={() => void onSubmit(buildMuxSubs(file.info, subPath))}
        >
          Anexar…
        </button>
      </div>
    </div>
  );
}

function TracksTab({ file, onSubmit }: TabProps) {
  const [audioKeep, setAudioKeep] = useState<number[]>(file.info.audio.map((a) => a.index));
  const [subKeep, setSubKeep] = useState<number[]>(file.info.subs.map((s) => s.index));
  const toast = useUi((s) => s.toast);

  function toggle(list: number[], setList: (v: number[]) => void, idx: number) {
    setList(list.includes(idx) ? list.filter((i) => i !== idx) : [...list, idx].sort());
  }

  return (
    <div className="tab-body">
      <p className="card-hint">
        Escolha o que fica no arquivo (sem recodificar — instantâneo). Útil pra remover
        áudios dublados ou legendas de um MKV.
      </p>
      {file.info.audio.length > 0 && (
        <div className="track-group">
          <div className="track-title">Áudio</div>
          {file.info.audio.map((a) => (
            <label key={a.index} className="check-row">
              <input
                type="checkbox"
                checked={audioKeep.includes(a.index)}
                onChange={() => toggle(audioKeep, setAudioKeep, a.index)}
              />
              <span>
                Faixa {a.index + 1}: {a.codec} {a.channels}ch{" "}
                {a.lang && <span className="chip">{a.lang}</span>} {a.title}
              </span>
            </label>
          ))}
        </div>
      )}
      {file.info.subs.length > 0 && (
        <div className="track-group">
          <div className="track-title">Legendas</div>
          {file.info.subs.map((s) => (
            <label key={s.index} className="check-row">
              <input
                type="checkbox"
                checked={subKeep.includes(s.index)}
                onChange={() => toggle(subKeep, setSubKeep, s.index)}
              />
              <span>
                Legenda {s.index + 1}: {s.codec} {s.lang && <span className="chip">{s.lang}</span>}{" "}
                {s.title}
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="tab-foot">
        <button
          className="btn primary"
          onClick={() => {
            if (file.info.audio.length > 0 && audioKeep.length === 0 && !file.info.video) {
              toast("error", "Selecione ao menos uma faixa.");
              return;
            }
            void onSubmit(buildTracks(file.info, audioKeep, subKeep));
          }}
        >
          Aplicar…
        </button>
      </div>
    </div>
  );
}

function AdjustTab({ file, onSubmit }: TabProps) {
  const [width, setWidth] = useState(1280);
  const [rotation, setRotation] = useState<Rotation>(90);
  const hasVideo = file.info.video !== null;
  return (
    <div className="tab-body adjust">
      {hasVideo && (
        <div className="adjust-row">
          <div>
            <b>Redimensionar</b>
            <div className="card-hint">
              largura alvo (altura proporcional) — original: {file.info.video?.width}×
              {file.info.video?.height}
            </div>
          </div>
          <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            {[3840, 1920, 1280, 854, 640, 480].map((w) => (
              <option key={w} value={w}>
                {w}px
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => void onSubmit(buildResize(file.info, width))}>
            Aplicar…
          </button>
        </div>
      )}
      {hasVideo && (
        <div className="adjust-row">
          <div>
            <b>Rotacionar</b>
            <div className="card-hint">vídeo gravado deitado? gire de vez (recodifica)</div>
          </div>
          <select
            value={rotation}
            onChange={(e) => setRotation(Number(e.target.value) as Rotation)}
          >
            <option value={90}>90° horário</option>
            <option value={180}>180°</option>
            <option value={270}>90° anti-horário</option>
          </select>
          <button className="btn" onClick={() => void onSubmit(buildRotate(file.info, rotation))}>
            Aplicar…
          </button>
        </div>
      )}
      <div className="adjust-row">
        <div>
          <b>Normalizar volume</b>
          <div className="card-hint">
            nivela o áudio pro padrão de streaming (loudnorm EBU R128) — bom pra áudio baixo
            ou irregular
          </div>
        </div>
        <span />
        <button className="btn" onClick={() => void onSubmit(buildLoudnorm(file.info))}>
          Aplicar…
        </button>
      </div>
    </div>
  );
}
