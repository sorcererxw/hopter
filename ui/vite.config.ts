import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const devHost = process.env.ORCHD_UI_DEV_HOST?.trim() || "0.0.0.0"
const previewHost = process.env.ORCHD_UI_PREVIEW_HOST?.trim() || devHost

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: devHost,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: previewHost,
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
})
