import { createConnectTransport } from "@connectrpc/connect-web"

function getBaseUrl() {
  const explicit = import.meta.env.VITE_CONNECT_BASE_URL
  if (explicit && explicit.length > 0) {
    return explicit
  }

  // In local dev and the packaged app, the browser talks to the same origin and
  // the Go server serves Connect under `/rpc`.
  return `${window.location.origin}/rpc`
}

export const transport = createConnectTransport({
  baseUrl: getBaseUrl(),
  useBinaryFormat: false,
})
