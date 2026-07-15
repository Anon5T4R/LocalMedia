// Lote: o mesmo preset de conversão aplicado em N arquivos, saída ao lado de
// cada original com sufixo (nome livre garantido pelo unique_path do Rust).

import { useState } from "react";
import * as be from "../lib/backend";
import { t } from "../lib/i18n";
import { buildConvert, PRESETS, type PresetId } from "../lib/presets";
import { suggestOut, useStore } from "../state/store";
import { useUi } from "../state/ui";

export default function BatchModal() {
  const open = useUi((s) => s.batchOpen);
  const setOpen = useUi((s) => s.setBatchOpen);
  const toast = useUi((s) => s.toast);
  const files = useStore((s) => s.files);
  const enqueue = useStore((s) => s.enqueue);
  const [preset, setPreset] = useState<PresetId>("mp4-web");
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  if (!open) return null;

  const chosen = files.filter((f) => picked[f.id] ?? f.selected);
  const presetDef = PRESETS.find((p) => p.id === preset);

  async function run() {
    if (chosen.length === 0) {
      toast("error", t("batch.selectOne"));
      return;
    }
    for (const f of chosen) {
      if (!f.info.video && !presetDef?.audioOnly) {
        toast("info", t("batch.skipNoVideo", { name: f.info.name }));
        continue;
      }
      const built = buildConvert(f.info, preset);
      const out = await be.uniquePath(suggestOut(f.info.path, built.suffix, built.ext));
      enqueue(built, out);
    }
    setOpen(false);
    toast("success", t("batch.queued", { n: chosen.length }));
  }

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{t("batch.title")}</h2>
          <button className="icon-btn" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <p className="card-hint">{t("batch.hint")}</p>
        <select value={preset} onChange={(e) => setPreset(e.target.value as PresetId)}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(p.label)}
            </option>
          ))}
        </select>
        <div className="batch-files">
          {files.map((f) => (
            <label key={f.id} className="check-row">
              <input
                type="checkbox"
                checked={picked[f.id] ?? f.selected}
                onChange={(e) => setPicked((p) => ({ ...p, [f.id]: e.target.checked }))}
              />
              <span>{f.info.name}</span>
            </label>
          ))}
        </div>
        <div className="tab-foot">
          <button className="btn primary" onClick={() => void run()}>
            {t("batch.convertBtn", { n: chosen.length })}
          </button>
        </div>
      </div>
    </div>
  );
}
