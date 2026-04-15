import { createConnectTransport } from "@connectrpc/connect-web"

function getBaseUrl() {
  const explicit = import.meta.env.VITE_CONNECT_BASE_URL
  if (explicit && explicit.length > 0) {
    return explicit
  }

  return `${window.location.origin}/rpc`
}

export const transport = createConnectTransport({
  baseUrl: getBaseUrl(),
  useBinaryFormat: false,
})
