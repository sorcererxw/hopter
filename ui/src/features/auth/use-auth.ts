import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  getBrowserInstanceId,
  getTabId,
} from "@/features/terminal/browser-identity"
import { queryKeys } from "@/lib/query/keys"

type AuthStatus = {
  authenticated: boolean
  user?: {
    id: string
    mode: string
  }
}

// Auth still uses simple REST endpoints rather than Connect because the flow is
// browser-session oriented and intentionally minimal for localhost v1.
async function getAuthStatus(): Promise<AuthStatus> {
  const response = await fetch("/api/auth/me", {
    credentials: "same-origin",
  })
  if (!response.ok) {
    throw new Error(`/api/auth/me returned ${response.status}`)
  }
  const payload = (await response.json()) as {
    data?: AuthStatus
  }
  return payload.data ?? { authenticated: true }
}

async function loginRequest() {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
  })
  if (!response.ok) {
    throw new Error(`/api/auth/login returned ${response.status}`)
  }
}

async function logoutRequest() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      browserInstanceId: getBrowserInstanceId(),
      tabId: getTabId(),
    }),
  })
  if (!response.ok) {
    throw new Error(`/api/auth/logout returned ${response.status}`)
  }
}

export function useAuthStatus() {
  return useQuery({
    queryKey: queryKeys.authStatus(),
    queryFn: getAuthStatus,
    staleTime: 5_000,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: loginRequest,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.authStatus() })
      await queryClient.invalidateQueries({ queryKey: queryKeys.config() })
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: logoutRequest,
    onSuccess: async () => {
      // Logout invalidates auth and drops config cache because the next session
      // may belong to a different local browser identity.
      await queryClient.invalidateQueries({ queryKey: queryKeys.authStatus() })
      queryClient.removeQueries({ queryKey: queryKeys.config() })
    },
  })
}
