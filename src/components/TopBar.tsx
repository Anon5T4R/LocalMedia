import { open } from "@tauri-apps/plugin-dialog";
import { LOCALE_LABELS, type Locale, setLocale, t, useLocale } from "../lib/i18n";
import { THEME_LABEL_KEYS, THEMES, type Theme } from "../lib/theme";
import { IMAGE_EXTENSIONS, MEDIA_EXTENSIONS } from "../lib/types";
import { useEditor } from "../state/editor";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

const LOCALES: Locale[] = ["pt", "en", "es"];

interface Props {
  theme: Theme;
  onChangeTheme(theme: Theme): void;
}

export default function TopBar({ theme, onChangeTheme }: Props) {
  const addPaths = useStore((s) => s.addPaths);
  const files = useStore((s) => s.files);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const setBatchOpen = useUi((s) => s.setBatchOpen);
  const locale = useLocale();

  async function pickFiles() {
    const inEditor = view === "editor";
    const picked = await open({
      multiple: true,
      title: inEditor ? t("topbar.addMediaProject") : t("topbar.openMedia"),
      filters: [
        {
          name: inEditor ? t("topbar.filterMediaImages") : t("topbar.filterVideoAudio"),
          extensions: inEditor ? [...MEDIA_EXTENSIONS, ...IMAGE_EXTENSIONS] : MEDIA_EXTENSIONS,
        },
      ],
    }).catch(() => null);
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    if (inEditor) void useEditor.getState().addMediaPaths(paths);
    else void addPaths(paths);
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">▶</span>
        <span className="brand-name">LocalMedia</span>
      </div>
      <div className="view-switch">
        <button
          className={`view-btn ${view === "home" ? "active" : ""}`}
          onClick={() => setView("home")}
        >
          {t("topbar.convert")}
        </button>
        <button
          className={`view-btn ${view === "editor" ? "active" : ""}`}
          onClick={() => setView("editor")}
        >
          {t("topbar.editor")}
        </button>
      </div>
      <div className="topbar-actions">
        <button className="btn primary" onClick={pickFiles}>
          + {t("topbar.openMedia")}
        </button>
        {view === "home" && files.length > 1 && (
          <button className="btn" onClick={() => setBatchOpen(true)}>
            {t("topbar.batch")}
          </button>
        )}
        <select
          className="theme-select"
          value={theme}
          onChange={(e) => onChangeTheme(e.target.value as Theme)}
          title={t("topbar.theme")}
        >
          {THEMES.map((th) => (
            <option key={th} value={th}>
              {t(THEME_LABEL_KEYS[th])}
            </option>
          ))}
        </select>
        <select
          className="lang-select"
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          title="Idioma / Language"
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}
