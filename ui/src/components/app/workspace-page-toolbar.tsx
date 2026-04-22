import { useNavigate } from "react-router-dom"

import { useWorkspaceShell } from "@/components/app/workspace-shell-context"
import {
  WorkspaceTopbar,
  type WorkspaceTopbarProps,
} from "@/components/app/workspace-topbar"

type WorkspacePageToolbarProps = Omit<
  WorkspaceTopbarProps,
  "leadingAction" | "onLeadingAction" | "toolbarMode"
> & {
  forceBack?: boolean
  onForceBack?: () => void
  phoneBackTo?: string
}

export function WorkspacePageToolbar({
  forceBack = false,
  onForceBack,
  phoneBackTo = "/",
  ...props
}: WorkspacePageToolbarProps) {
  const navigate = useNavigate()
  const { posture, toggleRail, toolbarMode } = useWorkspaceShell()
  const leadingAction =
    forceBack || posture === "phone" ? "back" : "toggle-rail"

  function handleLeadingAction() {
    if (forceBack) {
      if (onForceBack) {
        onForceBack()
        return
      }
      navigate(phoneBackTo)
      return
    }

    if (posture === "phone") {
      navigate(phoneBackTo)
      return
    }

    toggleRail()
  }

  return (
    <WorkspaceTopbar
      leadingAction={leadingAction}
      onLeadingAction={handleLeadingAction}
      toolbarMode={toolbarMode}
      {...props}
    />
  )
}
