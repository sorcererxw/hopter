import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { registerSW } from "virtual:pwa-register"

import "simplebar-react/dist/simplebar.min.css"
import "./index.css"
import App from "./App"

const rootElement = document.getElementById("root")
const isRelayCallbackAPINavigation =
  window.location.pathname === "/api/relay/callback"
const isRelayCallbackUIRoute = window.location.pathname === "/relay/callback"
const shouldBypassRelayCallbackServiceWorker =
  isRelayCallbackAPINavigation || isRelayCallbackUIRoute
let didScheduleRelayCallbackReload = false

if (!rootElement) {
  throw new Error("Root element #root was not found")
}

if (shouldBypassRelayCallbackServiceWorker && "serviceWorker" in navigator) {
  const bypassKey = "hopter:relay-callback-sw-bypass-url"
  const currentURL = window.location.href

  if (window.sessionStorage.getItem(bypassKey) !== currentURL) {
    window.sessionStorage.setItem(bypassKey, currentURL)
    didScheduleRelayCallbackReload = true
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

if (!isRelayCallbackAPINavigation && !didScheduleRelayCallbackReload) {
  if ("serviceWorker" in navigator && !isRelayCallbackUIRoute) {
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
