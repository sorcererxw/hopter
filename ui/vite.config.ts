import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

const devHost = process.env.HOPTER_UI_DEV_HOST?.trim() || "0.0.0.0"
const previewHost = process.env.HOPTER_UI_PREVIEW_HOST?.trim() || devHost

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icons/hopter-icon.svg", "icons/hopter-icon-maskable.svg"],
      manifest: {
        id: "/",
        name: "hopter workspace",
        short_name: "hopter",
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
            src: "/icons/hopter-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "/icons/hopter-icon-maskable.svg",
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
    allowedHosts: true,
    host: devHost,
    port: 5173,
    strictPort: true,
  },
  preview: {
    allowedHosts: true,
    host: previewHost,
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
})
