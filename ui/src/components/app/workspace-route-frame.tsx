import { Outlet } from "react-router-dom"

import { WorkspaceLayout } from "@/components/app/workspace-layout"
import { Toaster } from "@/components/ui/sonner"

export function WorkspaceRouteFrame() {
  return (
    <>
      <WorkspaceLayout>
        <Outlet />
      </WorkspaceLayout>
      <Toaster />
    </>
  )
}
