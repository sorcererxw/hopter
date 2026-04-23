export const PHONE_MAX_WIDTH = 639
export const WIDE_MIN_WIDTH = 1024

// The shell owns exactly three semantic postures. Everything else in the UI
// derives responsive behavior from this shared classification.
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
  // Compact mode uses the mobile toolbar only while the rail is expanded inline.
  if (posture === "phone") {
    return "mobile"
  }

  if (posture === "compact" && railVisible) {
    return "mobile"
  }

  return "desktop"
}
