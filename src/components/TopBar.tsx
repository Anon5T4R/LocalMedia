import { open } from "@tauri-apps/plugin-dialog";
import { MEDIA_EXTENSIONS } from "../lib/types";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

interface Props {
  theme: "light" | "dark";
  onToggleTheme(): void;
}

export default function TopBar({ theme, onToggleTheme }: Props) {
  const addPaths = useStore((s) => s.addPaths);
  const files = useStore((s) => s.files);
  const setBatchOpen = useUi((s) => s.setBatchOpen);

  async function pickFiles() {
    const picked = await open({
      multiple: true,
      title: "Abrir mídia",
      filters: [{ name: "Vídeo e áudio", extensions: MEDIA_EXTENSIONS }],
    }).catch(() => null);
    if (!picked) return;
    void addPaths(Array.isArray(picked) ? picked : [picked]);
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">▶</span>
        <span className="brand-name">LocalMedia</span>
      </div>
      <div className="topbar-actions">
        <button className="btn primary" onClick={pickFiles}>
          + Abrir mídia
        </button>
        {files.length > 1 && (
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
