import { open } from "@tauri-apps/plugin-dialog";
import { IMAGE_EXTENSIONS, MEDIA_EXTENSIONS } from "../lib/types";
import { useEditor } from "../state/editor";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

interface Props {
  theme: "light" | "dark";
  onToggleTheme(): void;
}

export default function TopBar({ theme, onToggleTheme }: Props) {
  const addPaths = useStore((s) => s.addPaths);
  const files = useStore((s) => s.files);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const setBatchOpen = useUi((s) => s.setBatchOpen);

  async function pickFiles() {
    const inEditor = view === "editor";
    const picked = await open({
      multiple: true,
      title: inEditor ? "Adicionar mídia ao projeto" : "Abrir mídia",
      filters: [
        {
          name: inEditor ? "Mídia e imagens" : "Vídeo e áudio",
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
          Converter
        </button>
        <button
          className={`view-btn ${view === "editor" ? "active" : ""}`}
          onClick={() => setView("editor")}
        >
          Editor
        </button>
      </div>
      <div className="topbar-actions">
        <button className="btn primary" onClick={pickFiles}>
          + Abrir mídia
        </button>
        {view === "home" && files.length > 1 && (
          <button className="btn" onClick={() => setBatchOpen(true)}>
            Lote
          </button>
        )}
        <button
          className="icon-btn"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Tema claro" : "Tema escuro"}
        >
          {theme === "dark" ? "☀" : "🌙"}
        </button>
      </div>
    </header>
  );
}
