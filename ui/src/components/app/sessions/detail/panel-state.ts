export type SessionPanelMode = "file" | "review"
export type SessionReviewView = "file" | "full"

export type ParsedSessionPathRef = {
  path: string
  line?: number
  column?: number
}

export type SessionPanelState = {
  panel: SessionPanelMode | null
  path: string | null
  line?: number
  column?: number
  reviewFile: string | null
  reviewView: SessionReviewView
}

export function parseSessionPathReference(raw: string): ParsedSessionPathRef {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { path: "" }
  }

  const hashMatch = trimmed.match(/^(.*)#L(\d+)(?:C(\d+))?$/)
  if (hashMatch) {
    return {
      path: hashMatch[1].trim(),
      line: Number(hashMatch[2]),
      column: hashMatch[3] ? Number(hashMatch[3]) : undefined,
    }
  }

  const colonMatch = trimmed.match(/^(.*):(\d+)(?::(\d+))?$/)
  if (colonMatch) {
    return {
      path: colonMatch[1].trim(),
      line: Number(colonMatch[2]),
      column: colonMatch[3] ? Number(colonMatch[3]) : undefined,
    }
  }

  return { path: trimmed }
}

export function readSessionPanelState(
  searchParams: URLSearchParams
): SessionPanelState {
  const rawPanel = searchParams.get("panel")
  const panel = rawPanel === "file" || rawPanel === "review" ? rawPanel : null
  const path = normalizeNullable(searchParams.get("path"))
  const reviewFile = normalizeNullable(searchParams.get("reviewFile"))
  const reviewView = searchParams.get("reviewView") === "full" ? "full" : "file"

  return {
    panel,
    path,
    line: parseOptionalInt(searchParams.get("line")),
    column: parseOptionalInt(searchParams.get("column")),
    reviewFile,
    reviewView,
  }
}

export function buildFilePanelParams(
  current: URLSearchParams,
  reference: ParsedSessionPathRef
): URLSearchParams {
  const next = new URLSearchParams(current)
  next.set("panel", "file")
  next.set("path", reference.path)
  setOptionalInt(next, "line", reference.line)
  setOptionalInt(next, "column", reference.column)
  return next
}

export function buildReviewPanelParams(
  current: URLSearchParams,
  input?: {
    reviewFile?: string | null
    reviewView?: SessionReviewView
  }
): URLSearchParams {
  const next = new URLSearchParams(current)
  next.set("panel", "review")
  next.delete("path")
  next.delete("line")
  next.delete("column")
  if (input?.reviewFile) {
    next.set("reviewFile", input.reviewFile)
  }
  if (input?.reviewView) {
    next.set("reviewView", input.reviewView)
  }
  return next
}

export function buildClosedPanelParams(
  current: URLSearchParams
): URLSearchParams {
  const next = new URLSearchParams(current)
  next.delete("panel")
  next.delete("path")
  next.delete("line")
  next.delete("column")
  return next
}

export function buildReviewSelectionParams(
  current: URLSearchParams,
  input: {
    reviewFile?: string | null
    reviewView?: SessionReviewView
  }
): URLSearchParams {
  const next = new URLSearchParams(current)
  if (input.reviewFile) {
    next.set("reviewFile", input.reviewFile)
  } else {
    next.delete("reviewFile")
  }
  if (input.reviewView) {
    next.set("reviewView", input.reviewView)
  }
  return next
}

function parseOptionalInt(value: string | null) {
  if (!value) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function setOptionalInt(params: URLSearchParams, key: string, value?: number) {
  if (value && Number.isFinite(value) && value > 0) {
    params.set(key, String(value))
    return
  }
  params.delete(key)
}

function normalizeNullable(value: string | null) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
