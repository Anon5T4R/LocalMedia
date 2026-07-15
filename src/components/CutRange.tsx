// Seleção de trecho com timeline visual: miniaturas extraídas pelo ffmpeg,
// faixa destacada, preview <video> (quando o webview toca o formato) e botões
// "usar posição atual" pra marcar início/fim com precisão.

import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import * as be from "../lib/backend";
import { t } from "../lib/i18n";
import { fmtCut, parseCut } from "../lib/time";
import type { MediaFile } from "../lib/types";

interface Props {
  file: MediaFile;
  startMs: number;
  endMs: number;
  onChange(startMs: number, endMs: number): void;
}

export default function CutRange({ file, startMs, endMs, onChange }: Props) {
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [videoOk, setVideoOk] = useState(true);
  const [startText, setStartText] = useState(fmtCut(startMs));
  const [endText, setEndText] = useState(fmtCut(endMs));
  const videoRef = useRef<HTMLVideoElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const dur = file.info.durationMs;

  useEffect(() => {
    if (!file.info.video) return;
    be.thumbnails(file.id + "-strip", file.info.path, 12, dur)
      .then(setThumbs)
      .catch(() => {});
  }, [file.id, file.info.path, file.info.video, dur]);

  useEffect(() => setStartText(fmtCut(startMs)), [startMs]);
  useEffect(() => setEndText(fmtCut(endMs)), [endMs]);

  function clamp(v: number) {
    return Math.max(0, Math.min(dur, v));
  }

  function commitStart(text: string) {
    const v = parseCut(text);
    if (Number.isFinite(v)) onChange(clamp(Math.min(v, endMs - 100)), endMs);
    else setStartText(fmtCut(startMs));
  }
  function commitEnd(text: string) {
    const v = parseCut(text);
    if (Number.isFinite(v)) onChange(startMs, clamp(Math.max(v, startMs + 100)));
    else setEndText(fmtCut(endMs));
  }

  function clickStrip(e: React.MouseEvent) {
    const el = stripRef.current;
    const video = videoRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const t = clamp(frac * dur);
    if (video && videoOk) video.currentTime = t / 1000;
  }

  function markStart() {
    const v = videoRef.current;
    if (v) onChange(clamp(Math.min(v.currentTime * 1000, endMs - 100)), endMs);
  }
  function markEnd() {
    const v = videoRef.current;
    if (v) onChange(startMs, clamp(Math.max(v.currentTime * 1000, startMs + 100)));
  }

  const leftPct = dur > 0 ? (startMs / dur) * 100 : 0;
  const widthPct = dur > 0 ? ((endMs - startMs) / dur) * 100 : 100;

  return (
    <div className="cutrange">
      {file.info.video && videoOk ? (
        <video
          ref={videoRef}
          className="cut-preview"
          src={convertFileSrc(file.info.path)}
          controls
          preload="metadata"
          onError={() => setVideoOk(false)}
        />
      ) : file.info.video ? (
        <div className="cut-nopreview">{t("cut.noPreview")}</div>
      ) : (
        <audio
          className="cut-preview-audio"
          ref={videoRef as unknown as React.RefObject<HTMLAudioElement>}
          src={convertFileSrc(file.info.path)}
          controls
          preload="metadata"
          onError={() => setVideoOk(false)}
        />
      )}

      {thumbs.length > 0 && (
        <div className="cut-strip" ref={stripRef} onClick={clickStrip}>
          {thumbs.map((t) => (
            <img key={t} src={convertFileSrc(t)} alt="" draggable={false} />
          ))}
          <div
            className="cut-shade"
            style={{ left: 0, width: `${leftPct}%` }}
          />
          <div
            className="cut-shade"
            style={{ left: `${leftPct + widthPct}%`, right: 0 }}
          />
          <div
            className="cut-window"
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          />
        </div>
      )}

      <div className="cut-sliders">
        <input
          type="range"
          min={0}
          max={dur}
          step={100}
          value={startMs}
          onChange={(e) => onChange(clamp(Math.min(Number(e.target.value), endMs - 100)), endMs)}
        />
        <input
          type="range"
          min={0}
          max={dur}
          step={100}
          value={endMs}
          onChange={(e) => onChange(startMs, clamp(Math.max(Number(e.target.value), startMs + 100)))}
        />
      </div>

      <div className="cut-fields">
        <label>
          {t("cut.startLabel")}
          <input
            value={startText}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={(e) => commitStart(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitStart((e.target as HTMLInputElement).value);
            }}
          />
        </label>
        {videoOk && (
          <button className="btn small" onClick={markStart}>
            {t("cut.useCurrent")}
          </button>
        )}
        <label>
          {t("cut.endLabel")}
          <input
            value={endText}
            onChange={(e) => setEndText(e.target.value)}
            onBlur={(e) => commitEnd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEnd((e.target as HTMLInputElement).value);
            }}
          />
        </label>
        {videoOk && (
          <button className="btn small" onClick={markEnd}>
            {t("cut.useCurrent")}
          </button>
        )}
        <span className="cut-durlabel">{t("cut.segment", { dur: fmtCut(endMs - startMs) })}</span>
      </div>
    </div>
  );
}
