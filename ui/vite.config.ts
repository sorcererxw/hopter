import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

const devHost = "0.0.0.0"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "icons/hopter-icon.svg",
        "icons/hopter-icon-192.png",
        "icons/hopter-icon-512.png",
        "icons/hopter-icon-maskable.svg",
        "icons/hopter-icon-maskable-512.png",
      ],
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
            src: "/icons/hopter-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/hopter-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/hopter-icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
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
    host: devHost,
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
})
