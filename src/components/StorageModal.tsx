import { useCallback, useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import * as be from "../lib/backend";
import { t } from "../lib/i18n";
import { fmtBytes } from "../lib/time";
import { useEditor } from "../state/editor";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

type CleanKind = "thumbs" | "tmp";

/**
 * Painel "Dados e armazenamento".
 *
 * Os `liveIds` que ele manda ao Rust são o SEGUNDO portão da limpeza: o
 * primeiro é a data (pasta anterior ao início da sessão), e nada é apagado sem
 * os dois concordarem. Existe pra o relógio não mandar sozinho — um ajuste de
 * horário no meio do uso faria a pasta da sessão atual parecer velha, e sem
 * este portão a limpeza levaria a miniatura que está na tela.
 */
export default function StorageModal({ onClose }: { onClose: () => void }) {
  const files = useStore((s) => s.files);
  const queue = useStore((s) => s.queue);
  const clips = useEditor((s) => s.clips);
  const toast = useUi((s) => s.toast);

  const [info, setInfo] = useState<be.StorageInfo | null>(null);
  const [confirm, setConfirm] = useState<CleanKind | null>(null);
  const [busy, setBusy] = useState(false);

  /** Tudo que esta sessão pode estar referenciando. Na dúvida, mande demais:
   *  id a mais só PRESERVA, id a menos apagaria algo em uso. */
  const liveIds = useCallback(
    () => [...files.map((f) => f.id), ...queue.map((j) => j.id), ...clips.map((c) => c.id)],
    [files, queue, clips],
  );

  const refresh = useCallback(async () => {
    try {
      setInfo(await be.storageInfo(liveIds()));
    } catch (e) {
      toast("error", t("storage.failed", { e: String(e) }));
    }
  }, [liveIds, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(kind: CleanKind) {
    setConfirm(null);
    setBusy(true);
    try {
      const freed =
        kind === "thumbs"
          ? await be.storageClearOldThumbs(liveIds())
          : await be.storageClearOldTmp(liveIds());
      toast(
        "success",
        freed.files === 0
          ? t("storage.nothing")
          : t("storage.freed", { size: fmtBytes(freed.bytes), n: freed.files }),
      );
      await refresh();
    } catch (e) {
      toast("error", t("storage.failed", { e: String(e) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal storage-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t("storage.title")}</h2>
        <p className="storage-intro">{t("storage.intro")}</p>

        {info && (
          <>
            <div className="storage-row">
              <div className="storage-label">
                <span>{t("storage.path")}</span>
                <code className="storage-dir" title={info.dir}>
                  {info.dir}
                </code>
              </div>
              <button className="btn" onClick={() => void openPath(info.dir).catch(() => {})}>
                {t("storage.openFolder")}
              </button>
            </div>

            <div className="storage-row">
              <div className="storage-label">
                <span>
                  {t("storage.thumbs")} — <strong>{fmtBytes(info.thumbsBytes)}</strong>
                </span>
                <small>
                  {t("storage.thumbsCounts", { dirs: info.thumbsDirs, files: info.thumbsFiles })}
                </small>
                <small>{t("storage.thumbsHint")}</small>
              </div>
            </div>

            <div className="storage-row">
              <div className="storage-label">
                <span>{t("storage.oldThumbs")}</span>
                <small>
                  {t("storage.oldThumbsCounts", {
                    n: info.oldThumbsDirs,
                    size: fmtBytes(info.oldThumbsBytes),
                  })}
                </small>
                <small>{t("storage.oldThumbsHint")}</small>
              </div>
              <button
                className="btn"
                disabled={busy || info.oldThumbsDirs === 0}
                onClick={() => setConfirm("thumbs")}
              >
                {t("storage.clear")}
              </button>
            </div>

            <div className="storage-row">
              <div className="storage-label">
                <span>
                  {t("storage.tmp")} — <strong>{fmtBytes(info.tmpBytes)}</strong>
                </span>
                <small>{t("storage.tmpCounts", { n: info.tmpFiles })}</small>
                <small>{t("storage.tmpHint")}</small>
              </div>
            </div>

            <div className="storage-row">
              <div className="storage-label">
                <span>{t("storage.oldTmp")}</span>
                <small>
                  {t("storage.oldTmpCounts", {
                    n: info.oldTmpFiles,
                    size: fmtBytes(info.oldTmpBytes),
                  })}
                </small>
                <small>{t("storage.oldTmpHint")}</small>
              </div>
              <button
                className="btn"
                disabled={busy || info.oldTmpFiles === 0}
                onClick={() => setConfirm("tmp")}
              >
                {t("storage.clear")}
              </button>
            </div>
          </>
        )}

        {confirm && (
          <div className="storage-confirm">
            <strong>{t("storage.confirmTitle")}</strong>
            <p>{confirm === "thumbs" ? t("storage.confirmThumbs") : t("storage.confirmTmp")}</p>
            <div className="storage-confirm-actions">
              <button className="btn" onClick={() => setConfirm(null)}>
                {t("storage.cancel")}
              </button>
              <button className="btn danger" onClick={() => void run(confirm)}>
                {t("storage.confirmYes")}
              </button>
            </div>
          </div>
        )}

        <div className="storage-confirm-actions" style={{ marginTop: 14 }}>
          <button className="btn" onClick={onClose}>
            {t("storage.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
