import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { registerSW } from "virtual:pwa-register"

import "./index.css"
import App from "./App"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element #root was not found")
}

if ("serviceWorker" in navigator) {
  registerSW({
    immediate: true,
    onRegisterError(error) {
      console.error("Failed to register the orchd service worker", error)
    },
  })
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
