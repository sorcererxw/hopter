import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

const devHost = process.env.ORCHD_UI_DEV_HOST?.trim() || "0.0.0.0"
const previewHost = process.env.ORCHD_UI_PREVIEW_HOST?.trim() || devHost

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icons/orchd-icon.svg", "icons/orchd-icon-maskable.svg"],
      manifest: {
        id: "/",
        name: "orchd workspace",
        short_name: "orchd",
        description:
          "Thin remote control plane for local coding sessions, projects, and approvals.",
        theme_color: "#101010",
        background_color: "#101010",
        display: "standalone",
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/",
        lang: "en",
        icons: [
          {
            src: "/icons/orchd-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "/icons/orchd-icon-maskable.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallbackDenylist: [
          /^\/connect\//,
          /^\/events$/,
          /^\/healthz$/,
          /^\/readyz$/,
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
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
