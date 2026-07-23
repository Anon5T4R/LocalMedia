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
  buildCutSilence,
  buildGif,
  buildHideRegion,
  buildLoudnorm,
  buildMuxSubs,
  buildResize,
  buildRotate,
  buildTracks,
  buildWatermark,
  type Corner,
  estimateCompress,
  PRESETS,
  type BuiltJob,
  type PresetId,
  type Rotation,
} from "../lib/presets";
import { availableActions } from "../lib/capabilities";
import { t, type MessageKey } from "../lib/i18n";
import { fmtBytes } from "../lib/time";
import { IMAGE_EXTENSIONS, SUBTITLE_EXTENSIONS, type MediaFile } from "../lib/types";
import { suggestOut, useStore } from "../state/store";
import { useUi } from "../state/ui";

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

  const tabs = availableActions(file.info);

  async function submit(built: BuiltJob) {
    if (!file) return;
    const suggested = suggestOut(file.info.path, built.suffix, built.ext);
    const out = await save({
      title: t("task.saveAsTitle"),
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
          {tabs.map((a) => (
            <button
              key={a.id}
              className={`tab ${tab === a.id ? "active" : ""}`}
              onClick={() => openTask(file.id, a.id)}
            >
              {t(a.label)}
            </button>
          ))}
        </div>
        {tab === "converter" && <ConvertTab file={file} onSubmit={submit} />}
        {tab === "comprimir" && <CompressTab file={file} onSubmit={submit} />}
        {tab === "cortar" && <CutTab file={file} onSubmit={submit} />}
        {tab === "silencio" && <SilenceTab file={file} onSubmit={submit} />}
        {tab === "gif" && <GifTab file={file} onSubmit={submit} />}
        {tab === "legendas" && <SubsTab file={file} onSubmit={submit} />}
        {tab === "logo" && <WatermarkTab file={file} onSubmit={submit} />}
        {tab === "esconder" && <HideTab file={file} onSubmit={submit} />}
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
              <div className="preset-label">{t(p.label)}</div>
              <div className="preset-hint">{t(p.hint)}</div>
            </div>
          </label>
        ))}
      </div>
      <div className="tab-foot">
        <button className="btn primary" onClick={() => void onSubmit(buildConvert(file.info, preset))}>
          {t("task.convertBtn")}
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
      <p className="card-hint">{t("task.compressHint")}</p>
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
        {t("task.estLabel")} <b>{fmtBytes(est)}</b> {t("task.estNote")} {t("task.original")}:{" "}
        {fmtBytes(file.info.sizeBytes)}.
      </div>
      <div className="tab-foot">
        <button className="btn primary" onClick={() => void onSubmit(buildCompress(file.info, crf))}>
          {t("task.compressBtn")}
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
          <b>{t("task.cutFast")}</b> {t("task.cutFastHint")}
        </span>
      </label>
      <div className="tab-foot">
        <button
          className="btn primary"
          onClick={() => void onSubmit(buildCut(file.info, range[0], range[1], copy))}
        >
          {t("task.cutBtn")}
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
      toast("error", t("task.gifTooLong"));
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
          {t("task.width")}
          <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            {[240, 320, 480, 640, 800].map((w) => (
              <option key={w} value={w}>
                {w}px
              </option>
            ))}
          </select>
        </label>
        <span className="card-hint">{t("task.gifHint")}</span>
      </div>
      <div className="tab-foot">
        <button className="btn primary" onClick={() => void submit()}>
          {t("task.gifBtn")}
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
      title: t("task.subsPickTitle"),
      filters: [{ name: t("task.subsFilter"), extensions: SUBTITLE_EXTENSIONS }],
    }).catch(() => null);
    if (picked && !Array.isArray(picked)) {
      setSubPath(picked);
      setSource("file");
    }
  }

  function burn() {
    if (source === "file" && !subPath) {
      toast("error", t("task.subsPickFirst"));
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
        <b>{t("task.subsBurn")}</b> {t("task.subsHint1")} <b>{t("task.subsMux")}</b>{" "}
        {t("task.subsHint2")}
      </p>

      <div className="track-group">
        <div className="track-title">{t("task.subsSource")}</div>
        <label className="check-row">
          <input
            type="radio"
            name="subsrc"
            checked={source === "file"}
            onChange={() => setSource("file")}
          />
          <span>
            {t("task.subsFile")}{" "}
            <button className="btn small" onClick={() => void pickSub()}>
              {subPath ? subName : t("task.choose")}
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
              {t("task.subsEmbedded")}{" "}
              <select
                value={embIndex}
                onChange={(e) => {
                  setEmbIndex(Number(e.target.value));
                  setSource("embedded");
                }}
              >
                {file.info.subs.map((s) => (
                  <option key={s.index} value={s.index}>
                    {t("task.subLabelPrefix", { n: s.index + 1 })} {s.lang && `(${s.lang})`} {s.title}
                  </option>
                ))}
              </select>
            </span>
          </label>
        )}
      </div>

      <div className="adjust-row">
        <div>
          <b>{t("task.subsBurnTitle")}</b>
          <div className="card-hint">{t("task.subsBurnHint")}</div>
        </div>
        <select value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}>
          <option value={0}>{t("task.sizeDefault")}</option>
          <option value={18}>{t("task.sizeSmall")}</option>
          <option value={24}>{t("task.sizeMedium")}</option>
          <option value={32}>{t("task.sizeLarge")}</option>
        </select>
        <button className="btn primary" onClick={burn}>
          {t("task.burnBtn")}
        </button>
      </div>

      <div className="adjust-row">
        <div>
          <b>{t("task.subsMux")}</b>
          <div className="card-hint">{t("task.subsMuxHint")}</div>
        </div>
        <span />
        <button
          className="btn"
          disabled={!subPath}
          onClick={() => void onSubmit(buildMuxSubs(file.info, subPath))}
        >
          {t("task.muxBtn")}
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
      <p className="card-hint">{t("task.tracksHint")}</p>
      {file.info.audio.length > 0 && (
        <div className="track-group">
          <div className="track-title">{t("task.audio")}</div>
          {file.info.audio.map((a) => (
            <label key={a.index} className="check-row">
              <input
                type="checkbox"
                checked={audioKeep.includes(a.index)}
                onChange={() => toggle(audioKeep, setAudioKeep, a.index)}
              />
              <span>
                {t("task.trackPrefix", { n: a.index + 1 })} {a.codec} {a.channels}ch{" "}
                {a.lang && <span className="chip">{a.lang}</span>} {a.title}
              </span>
            </label>
          ))}
        </div>
      )}
      {file.info.subs.length > 0 && (
        <div className="track-group">
          <div className="track-title">{t("action.subs")}</div>
          {file.info.subs.map((s) => (
            <label key={s.index} className="check-row">
              <input
                type="checkbox"
                checked={subKeep.includes(s.index)}
                onChange={() => toggle(subKeep, setSubKeep, s.index)}
              />
              <span>
                {t("task.subTrackPrefix", { n: s.index + 1 })} {s.codec}{" "}
                {s.lang && <span className="chip">{s.lang}</span>} {s.title}
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
              toast("error", t("task.selectOneTrack"));
              return;
            }
            void onSubmit(buildTracks(file.info, audioKeep, subKeep));
          }}
        >
          {t("common.apply")}
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
            <b>{t("task.resize")}</b>
            <div className="card-hint">
              {t("task.resizeHint", {
                w: file.info.video?.width ?? 0,
                h: file.info.video?.height ?? 0,
              })}
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
            {t("common.apply")}
          </button>
        </div>
      )}
      {hasVideo && (
        <div className="adjust-row">
          <div>
            <b>{t("task.rotate")}</b>
            <div className="card-hint">{t("task.rotateHint")}</div>
          </div>
          <select
            value={rotation}
            onChange={(e) => setRotation(Number(e.target.value) as Rotation)}
          >
            <option value={90}>{t("task.rot90cw")}</option>
            <option value={180}>180°</option>
            <option value={270}>{t("task.rot90ccw")}</option>
          </select>
          <button className="btn" onClick={() => void onSubmit(buildRotate(file.info, rotation))}>
            {t("common.apply")}
          </button>
        </div>
      )}
      <div className="adjust-row">
        <div>
          <b>{t("task.loudnorm")}</b>
          <div className="card-hint">{t("task.loudnormHint")}</div>
        </div>
        <span />
        <button className="btn" onClick={() => void onSubmit(buildLoudnorm(file.info))}>
          {t("common.apply")}
        </button>
      </div>
    </div>
  );
}

/** Seletor de canto compartilhado (logo e esconder-logo). Cinco botões com
 *  símbolo — a posição diz em qualquer idioma onde a coisa fica. */
const CORNERS: [Corner, string, MessageKey][] = [
  ["tl", "◤", "task.cornerTL"],
  ["tr", "◥", "task.cornerTR"],
  ["center", "◉", "task.cornerCenter"],
  ["bl", "◣", "task.cornerBL"],
  ["br", "◢", "task.cornerBR"],
];
function CornerPicker({ corner, onPick }: { corner: Corner; onPick: (c: Corner) => void }) {
  return (
    <div className="corner-pick">
      {CORNERS.map(([c, sym, label]) => (
        <button
          key={c}
          className={`corner-btn ${corner === c ? "active" : ""}`}
          title={t(label)}
          aria-label={t(label)}
          aria-pressed={corner === c}
          onClick={() => onPick(c)}
        >
          {sym}
        </button>
      ))}
    </div>
  );
}

function WatermarkTab({ file, onSubmit }: TabProps) {
  const [logo, setLogo] = useState("");
  const [corner, setCorner] = useState<Corner>("br");
  const [size, setSize] = useState(0.18);
  const [opacity, setOpacity] = useState(0.85);
  const toast = useUi((s) => s.toast);
  const logoName = logo.split(/[\\/]/).pop() ?? "";

  async function pickLogo() {
    const picked = await open({
      multiple: false,
      title: t("task.logoPick"),
      filters: [{ name: t("task.logoFilter"), extensions: IMAGE_EXTENSIONS }],
    }).catch(() => null);
    if (picked && !Array.isArray(picked)) setLogo(picked);
  }

  function apply() {
    if (!logo) {
      toast("error", t("task.logoPickFirst"));
      return;
    }
    void onSubmit(buildWatermark(file.info, logo, corner, size, opacity));
  }

  return (
    <div className="tab-body">
      <p className="card-hint">{t("task.logoHint")}</p>
      <label className="field">
        <span>{t("task.logoFile")}</span>
        <button className="btn small" onClick={() => void pickLogo()}>
          {logo ? logoName : t("task.choose")}
        </button>
      </label>
      <div className="track-group">
        <div className="track-title">{t("task.position")}</div>
        <CornerPicker corner={corner} onPick={setCorner} />
      </div>
      <label className="field">
        <span>
          {t("task.logoSize")} <b>{Math.round(size * 100)}%</b>
        </span>
        <input type="range" min={0.05} max={0.5} step={0.01} value={size} onChange={(e) => setSize(Number(e.target.value))} />
      </label>
      <label className="field">
        <span>
          {t("task.logoOpacity")} <b>{Math.round(opacity * 100)}%</b>
        </span>
        <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
      </label>
      <div className="tab-foot">
        <button className="btn primary" onClick={apply}>
          {t("task.logoBtn")}
        </button>
      </div>
    </div>
  );
}

function HideTab({ file, onSubmit }: TabProps) {
  const [corner, setCorner] = useState<Corner>("tr");
  const [w, setW] = useState(0.18);
  const [h, setH] = useState(0.12);
  return (
    <div className="tab-body">
      <p className="card-hint">
        <b>{t("task.hideWarn")}</b> {t("task.hideHint")}
      </p>
      <div className="track-group">
        <div className="track-title">{t("task.hideWhere")}</div>
        <CornerPicker corner={corner} onPick={setCorner} />
      </div>
      <label className="field">
        <span>
          {t("task.hideW")} <b>{Math.round(w * 100)}%</b>
        </span>
        <input type="range" min={0.05} max={0.6} step={0.01} value={w} onChange={(e) => setW(Number(e.target.value))} />
      </label>
      <label className="field">
        <span>
          {t("task.hideH")} <b>{Math.round(h * 100)}%</b>
        </span>
        <input type="range" min={0.05} max={0.6} step={0.01} value={h} onChange={(e) => setH(Number(e.target.value))} />
      </label>
      <div className="tab-foot">
        <button className="btn primary" onClick={() => void onSubmit(buildHideRegion(file.info, corner, w, h))}>
          {t("task.hideBtn")}
        </button>
      </div>
    </div>
  );
}

function SilenceTab({ file, onSubmit }: TabProps) {
  const [threshold, setThreshold] = useState(-45);
  return (
    <div className="tab-body">
      <p className="card-hint">{t("task.silenceHint")}</p>
      <div className="crf-row">
        <span>−60 dB</span>
        <input type="range" min={-60} max={-20} step={1} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        <span>−20 dB</span>
        <b className="crf-value">{threshold} dB</b>
      </div>
      <div className="card-hint">{t("task.silenceThresholdHint")}</div>
      <div className="tab-foot">
        <button className="btn primary" onClick={() => void onSubmit(buildCutSilence(file.info, threshold))}>
          {t("task.silenceBtn")}
        </button>
      </div>
    </div>
  );
}
