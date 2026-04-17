import { createContext, useContext } from "react"

export type WorkspaceShellContextValue = {
  closeProjectPicker: () => void
  closeSidebar: () => void
  openProjectPicker: () => void
  openSearch: () => void
  openSidebar: () => void
  projectPickerOpen: boolean
  sidebarOpen: boolean
}

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
