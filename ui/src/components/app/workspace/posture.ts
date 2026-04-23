export const PHONE_MAX_WIDTH = 639
export const WIDE_MIN_WIDTH = 1024

export type WorkspacePosture = "phone" | "compact" | "wide"
export type WorkspaceToolbarMode = "mobile" | "desktop"

export function getWorkspacePosture(width: number): WorkspacePosture {
  if (width <= PHONE_MAX_WIDTH) {
    return "phone"
  }

  if (width >= WIDE_MIN_WIDTH) {
    return "wide"
  }

  return "compact"
}

export function getToolbarMode(
  posture: WorkspacePosture,
  railVisible: boolean
): WorkspaceToolbarMode {
  if (posture === "phone") {
    return "mobile"
  }

  if (posture === "compact" && railVisible) {
    return "mobile"
  }

  return "desktop"
}
