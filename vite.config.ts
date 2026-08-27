import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Dos páginas y no una. La captura rápida (spec 18) es otra ventana con otro webview, y
  // meterla en el bundle del panel le costaría cargar el riel, la lista, el detalle y los
  // ajustes para enseñar un campo de texto — justo lo que no puede pagar algo que tiene que
  // estar en pantalla en cuanto se suelta el atajo.
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        captura: "captura.html",
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
