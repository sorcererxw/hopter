import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

const devHost = "0.0.0.0"
const devBackendURL =
  process.env.HOPTER_DEV_BACKEND_URL || "http://127.0.0.1:8787"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: [
        "favicon.ico",
        "favicon.svg",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
        "icon-maskable-192.png",
        "icon-maskable-512.png",
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
            src: "/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icon-maskable-512.png",
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
    proxy: {
      "/api": {
        changeOrigin: true,
        target: devBackendURL,
      },
      "/events": {
        changeOrigin: true,
        target: devBackendURL,
      },
      "/healthz": {
        changeOrigin: true,
        target: devBackendURL,
      },
      "/readyz": {
        changeOrigin: true,
        target: devBackendURL,
      },
      "/rpc": {
        changeOrigin: true,
        target: devBackendURL,
      },
    },
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
    sourcemap: true,
  },
})
