import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Lição da suíte: forçar uma única instância do React pra nenhuma dependência
  // puxar uma 2ª cópia e quebrar os hooks ("Invalid hook call").
  resolve: {
    dedupe: ["react", "react-dom"],
  },

  build: {
    chunkSizeWarningLimit: 900,
  },

  // Opções do Vite ajustadas pro Tauri (só aplicadas em `tauri dev`/`tauri build`).
  clearScreen: false,
  server: {
    // Porta única do LocalMedia na suíte (LocalScribe=1444, este=1446). O Tauri
    // não tem fallback de porta — devUrl e esta porta têm que bater.
    port: 1446,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1447,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
