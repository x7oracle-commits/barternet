import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const isCapacitor = process.env.BUILD_TARGET === "capacitor";

export default defineConfig(({ command }) => ({
  // Relative base for the web build so the app works at any path — root, a
  // GitHub Pages subpath (/barternet/), or opened as a shared file. Dev server
  // and the Capacitor WebView stay on "/".
  base: command === "build" && !isCapacitor ? "./" : "/",

  plugins: isCapacitor
    ? [react()]
    : [react(), viteSingleFile()],

  build: {
    outDir: "dist",
    target: "esnext",
    // Single-file mode: inline everything into index.html (for Bluetooth sharing)
    // Capacitor mode: normal split build served by the native WebView
    assetsInlineLimit: isCapacitor ? 4096 : 100_000_000,
    cssCodeSplit: isCapacitor,
  },
}));
