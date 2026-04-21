import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { MessageInitShape } from "@bufbuild/protobuf"

import {
  ConfigTheme,
  UpdateConfigRequestSchema,
  type UserConfig,
} from "@/gen/proto/hopter/v1/config_pb"
import { configClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

export type ThemePreference = "system" | "dark" | "light"

export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config(),
    queryFn: async () => {
      const response = await configClient.getConfig({})
      return response.config
    },
    staleTime: 30_000,
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
  })
}

export function useUpdateConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      input: MessageInitShape<typeof UpdateConfigRequestSchema>
    ) => {
      const response = await configClient.updateConfig(input)
      return response.config
    },
    onSuccess: (config) => {
      if (config) {
        queryClient.setQueryData(queryKeys.config(), config)
      }
    },
  })
}

export function themePreferenceFromConfig(config?: UserConfig): ThemePreference {
  return themePreferenceFromProto(
    config?.appearance?.theme ?? ConfigTheme.SYSTEM
  )
}

export function themePreferenceFromProto(theme: ConfigTheme): ThemePreference {
  switch (theme) {
    case ConfigTheme.DARK:
      return "dark"
    case ConfigTheme.LIGHT:
      return "light"
    case ConfigTheme.SYSTEM:
    case ConfigTheme.UNSPECIFIED:
    default:
      return "system"
  }
}

export function themePreferenceToProto(theme: ThemePreference): ConfigTheme {
  switch (theme) {
    case "dark":
      return ConfigTheme.DARK
    case "light":
      return ConfigTheme.LIGHT
    case "system":
    default:
      return ConfigTheme.SYSTEM
  }
}
