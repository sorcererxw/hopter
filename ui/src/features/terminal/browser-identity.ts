const browserInstanceStorageKey = "orchd.browserInstanceId"
const tabStorageKey = "orchd.tabId"

function nextID(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}`
}

export function getBrowserInstanceId() {
  const existing = window.localStorage.getItem(browserInstanceStorageKey)
  if (existing) {
    return existing
  }
  const next = nextID("browser")
  window.localStorage.setItem(browserInstanceStorageKey, next)
  return next
}

export function getTabId() {
  const existing = window.sessionStorage.getItem(tabStorageKey)
  if (existing) {
    return existing
  }
  const next = nextID("tab")
  window.sessionStorage.setItem(tabStorageKey, next)
  return next
}
