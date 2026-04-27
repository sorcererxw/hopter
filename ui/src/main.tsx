import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { registerSW } from "virtual:pwa-register"

import "simplebar-react/dist/simplebar.min.css"
import "./index.css"
import App from "./App"

const rootElement = document.getElementById("root")
const isRelayCallbackNavigation =
  window.location.pathname === "/api/relay/callback"

if (!rootElement) {
  throw new Error("Root element #root was not found")
}

if (isRelayCallbackNavigation) {
  if ("serviceWorker" in navigator) {
    const bypassKey = "hopter:relay-callback-sw-bypass-url"
    const currentURL = window.location.href

    if (window.sessionStorage.getItem(bypassKey) !== currentURL) {
      window.sessionStorage.setItem(bypassKey, currentURL)
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations.map((registration) => registration.unregister())
          )
        )
        .finally(() => {
          window.location.replace(currentURL)
        })
    }
  }
} else {
  if ("serviceWorker" in navigator) {
    registerSW({
      immediate: true,
      onRegisterError(error) {
        console.error("Failed to register the hopter service worker", error)
      },
    })
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
