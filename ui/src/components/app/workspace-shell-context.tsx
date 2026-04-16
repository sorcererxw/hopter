import { createContext, useContext } from "react"

export type WorkspaceShellContextValue = {
  closeSidebar: () => void
  openSearch: () => void
  openSidebar: () => void
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
