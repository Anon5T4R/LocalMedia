// Ajuda do editor (botão ? / F1): atalhos de teclado e dicas de uso.

import { t, type MessageKey } from "../../lib/i18n";
import { useUi } from "../../state/ui";

const SHORTCUTS: [MessageKey, MessageKey][] = [
  ["help.sc.space.k", "help.sc.space.d"],
  ["help.sc.split.k", "help.sc.split.d"],
  ["help.sc.del.k", "help.sc.del.d"],
  ["help.sc.rdel.k", "help.sc.rdel.d"],
  ["help.sc.copy.k", "help.sc.copy.d"],
  ["help.sc.dup.k", "help.sc.dup.d"],
  ["help.sc.undo.k", "help.sc.undo.d"],
  ["help.sc.move.k", "help.sc.move.d"],
  ["help.sc.homeend.k", "help.sc.homeend.d"],
  ["help.sc.zoom.k", "help.sc.zoom.d"],
  ["help.sc.esc.k", "help.sc.esc.d"],
  ["help.sc.help.k", "help.sc.help.d"],
];

const TIPS: MessageKey[] = [
  "help.tip1",
  "help.tip2",
  "help.tip3",
  "help.tip4",
  "help.tip5",
  "help.tip6",
  "help.tip7",
  "help.tip8",
  "help.tip9",
];

export default function HelpModal() {
  const open = useUi((s) => s.helpOpen);
  const setOpen = useUi((s) => s.setHelpOpen);
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{t("help.title")}</h2>
          <button className="icon-btn" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <div className="help-cols">
          <div>
            <div className="track-title">{t("help.shortcuts")}</div>
            <table className="help-keys">
              <tbody>
                {SHORTCUTS.map(([k, desc]) => (
                  <tr key={k}>
                    <td>
                      <kbd>{t(k)}</kbd>
                    </td>
                    <td>{t(desc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
