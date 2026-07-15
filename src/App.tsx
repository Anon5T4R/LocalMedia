import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import BatchModal from "./components/BatchModal";
import EditorView from "./components/editor/EditorView";
import { resolveDropTarget } from "./components/editor/Timeline";
import HomeView from "./components/HomeView";
import TaskModal from "./components/TaskModal";
import Toasts from "./components/Toasts";
import TopBar from "./components/TopBar";
import { inTauri } from "./lib/backend";
import { t } from "./lib/i18n";
import { IMAGE_EXTENSIONS, MEDIA_EXTENSIONS } from "./lib/types";
import { useEditor } from "./state/editor";
import { useStore } from "./state/store";
import { useUi } from "./state/ui";

type Theme = "light" | "dark";

export default function App() {
  const init = useStore((s) => s.init);
  const addPaths = useStore((s) => s.addPaths);
  const view = useUi((s) => s.view);
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
          // No editor, imagens também valem (viram clipes de camada).
          const inEditor = useUi.getState().view === "editor";
          const accepted = inEditor
            ? [...MEDIA_EXTENSIONS, ...IMAGE_EXTENSIONS]
            : MEDIA_EXTENSIONS;
          const media = paths.filter((p) => {
            const ext = p.split(".").pop()?.toLowerCase() ?? "";
            return accepted.includes(ext);
          });
          if (media.length === 0 && paths.length > 0) {
            toast("error", t("app.dropNothing"));
            return;
          }
          if (inEditor) {
            // Mira trilha/tempo pela posição do drop (coordenadas físicas →
            // CSS) — soltar a música na faixa A2 cai na A2, como num NLE.
            const pos = event.payload.position;
            const scale = window.devicePixelRatio || 1;
            const target = pos ? resolveDropTarget(pos.x / scale, pos.y / scale) : null;
            void useEditor.getState().addMediaPathsAt(media, target ?? undefined);
          } else {
            void addPaths(media);
          }
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
      <main className={`main ${view === "editor" ? "main-editor" : ""}`}>
        {view === "editor" ? <EditorView /> : <HomeView />}
      </main>
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">{t("app.dropHere")}</div>
        </div>
      )}
      <TaskModal />
      <BatchModal />
      <Toasts />
    </div>
  );
}
