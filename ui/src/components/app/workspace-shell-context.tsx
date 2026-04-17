import { createContext, useContext } from "react"

import type {
  WorkspacePosture,
  WorkspaceToolbarMode,
} from "@/components/app/workspace-posture"

export type WorkspaceShellContextValue = {
  closeProjectPicker: () => void
  eventStreamState: WorkspaceEventStreamState
  hideRail: () => void
  lastEventAt: number | null
  openProjectPicker: () => void
  openSearch: () => void
  showRail: () => void
  projectPickerOpen: boolean
  posture: WorkspacePosture
  railVisible: boolean
  toggleRail: () => void
  toolbarMode: WorkspaceToolbarMode
}

export type WorkspaceEventStreamState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"

export const WorkspaceShellContext = createContext<
  WorkspaceShellContextValue | undefined
>(undefined)

export function useWorkspaceShell() {
  const context = useContext(WorkspaceShellContext)

  if (!context) {
    throw new Error("useWorkspaceShell must be used within WorkspaceLayout")
  }

  return context
}
