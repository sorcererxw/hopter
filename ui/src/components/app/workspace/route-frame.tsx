import { Outlet } from "react-router-dom"
import { Toaster } from "sonner"

import { WorkspaceLayout } from "./layout"

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
