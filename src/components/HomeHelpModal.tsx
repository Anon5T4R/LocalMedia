// Ajuda da tela Converter (? / F1): o catálogo de capacidades + dicas.
// Lê de lib/capabilities.ts — a mesma lista que alimenta a tela vazia.

import { CAPABILITIES } from "../lib/capabilities";
import { t, type MessageKey } from "../lib/i18n";
import { useUi } from "../state/ui";

const TIPS: MessageKey[] = [
  "hh.tip.select",
  "hh.tip.drop",
  "hh.tip.queue",
  "hh.tip.scribe",
  "hh.tip.editor",
];

export default function HomeHelpModal() {
  const open = useUi((s) => s.helpOpen);
  const setOpen = useUi((s) => s.setHelpOpen);
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{t("home.helpTitle")}</h2>
          <button className="icon-btn" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <div className="help-cols">
          <div>
            <div className="track-title">{t("home.helpCaps")}</div>
            <div className="help-caps">
              {CAPABILITIES.map((c) => (
                <div key={c.id} className="help-cap">
                  <span className="cap-icon">{c.icon}</span>
                  <span>
                    <b>{t(c.label)}</b> — {t(c.desc)}
                    <span className="cap-how"> · {t(c.how)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="track-title">{t("help.tips")}</div>
            <ul className="help-tips">
              {TIPS.map((tip) => (
                <li key={tip}>{t(tip)}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
