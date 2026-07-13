import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import BatchModal from "./components/BatchModal";
import HomeView from "./components/HomeView";
import TaskModal from "./components/TaskModal";
import Toasts from "./components/Toasts";
import TopBar from "./components/TopBar";
import { inTauri } from "./lib/backend";
import { MEDIA_EXTENSIONS } from "./lib/types";
import { useStore } from "./state/store";
import { useUi } from "./state/ui";

type Theme = "light" | "dark";

export default function App() {
  const init = useStore((s) => s.init);
  const addPaths = useStore((s) => s.addPaths);
  const toast = useUi((s) => s.toast);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Arrastar arquivos pra janela (evento nativo do Tauri).
  useEffect(() => {
    if (!inTauri()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") return;
        if (event.payload.type === "enter") setDragging(true);
        else if (event.payload.type === "leave") setDragging(false);
        else if (event.payload.type === "drop") {
          setDragging(false);
          const paths = event.payload.paths ?? [];
          const media = paths.filter((p) => {
            const ext = p.split(".").pop()?.toLowerCase() ?? "";
            return MEDIA_EXTENSIONS.includes(ext);
          });
          if (media.length === 0 && paths.length > 0) {
            toast("error", "Nenhum arquivo de mídia reconhecido nos itens soltos.");
            return;
          }
          void addPaths(media);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [addPaths, toast]);

  return (
    <div className="app">
      <TopBar theme={theme} onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")} />
      <main className="main">
        <HomeView />
      </main>
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">Solte os arquivos aqui</div>
        </div>
      )}
      <TaskModal />
      <BatchModal />
      <Toasts />
    </div>
  );
}
