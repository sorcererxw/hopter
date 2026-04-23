type SkillTokenRange = {
  end: number
  reference: string
  start: number
}

type AtomicSkillEditResult = {
  selectionEnd: number
  selectionStart: number
  value: string
}

export function normalizeAtomicSkillSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  skillReferences: ReadonlySet<string>
) {
  const start = clampSelectionIndex(value, selectionStart)
  const end = clampSelectionIndex(value, selectionEnd)
  const normalizedStart = Math.min(start, end)
  const normalizedEnd = Math.max(start, end)
  const ranges = findAtomicSkillTokenRanges(value, skillReferences)

  if (normalizedStart === normalizedEnd) {
    const token = ranges.find(
      (range) => range.start < normalizedStart && normalizedStart < range.end
    )
    if (!token) {
      return { changed: false, start: normalizedStart, end: normalizedEnd }
    }
    return { changed: true, start: token.start, end: token.end }
  }

  const touched = ranges.filter(
    (range) => normalizedStart < range.end && normalizedEnd > range.start
  )
  if (touched.length === 0) {
    return { changed: false, start: normalizedStart, end: normalizedEnd }
  }

  const nextStart = Math.min(
    normalizedStart,
    ...touched.map((range) => range.start)
  )
  const nextEnd = Math.max(
    normalizedEnd,
    ...touched.map((range) => range.end)
  )

  return {
    changed: nextStart !== normalizedStart || nextEnd !== normalizedEnd,
    start: nextStart,
    end: nextEnd,
  }
}

export function applyAtomicSkillDeletion(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  key: string,
  skillReferences: ReadonlySet<string>
): AtomicSkillEditResult | null {
  if (key !== "Backspace" && key !== "Delete") {
    return null
  }

  const start = clampSelectionIndex(value, selectionStart)
  const end = clampSelectionIndex(value, selectionEnd)
  const normalizedStart = Math.min(start, end)
  const normalizedEnd = Math.max(start, end)
  const ranges = findAtomicSkillTokenRanges(value, skillReferences)

  if (normalizedStart !== normalizedEnd) {
    const touched = ranges.filter(
      (range) => normalizedStart < range.end && normalizedEnd > range.start
    )
    if (touched.length === 0) {
      return null
    }
    let deleteStart = Math.min(
      normalizedStart,
      ...touched.map((range) => range.start)
    )
    let deleteEnd = Math.max(
      normalizedEnd,
      ...touched.map((range) => range.end)
    )
    if (
      touched.length === 1 &&
      normalizedStart >= touched[0].start &&
      normalizedEnd <= touched[0].end
    ) {
      const expanded = expandSingleTokenDeletionRange(value, touched[0])
      deleteStart = expanded.start
      deleteEnd = expanded.end
    }
    return removeTextRange(value, deleteStart, deleteEnd)
  }

  const token = tokenForAtomicDeletion(value, normalizedStart, key, ranges)
  if (!token) {
    return null
  }

  const range = expandSingleTokenDeletionRange(value, token)
  return removeTextRange(value, range.start, range.end)
}

function tokenForAtomicDeletion(
  value: string,
  position: number,
  key: "Backspace" | "Delete",
  ranges: SkillTokenRange[]
) {
  if (key === "Backspace") {
    return ranges.find((range) => {
      if (range.start < position && position <= range.end) {
        return true
      }
      return value[position - 1] === " " && range.end === position - 1
    })
  }

  return ranges.find((range) => range.start <= position && position < range.end)
}

function expandSingleTokenDeletionRange(
  value: string,
  range: SkillTokenRange
) {
  if (value[range.end] === " ") {
    return { start: range.start, end: range.end + 1 }
  }
  if (range.start > 0 && value[range.start - 1] === " ") {
    return { start: range.start - 1, end: range.end }
  }
  return { start: range.start, end: range.end }
}

function removeTextRange(value: string, start: number, end: number) {
  const nextValue = `${value.slice(0, start)}${value.slice(end)}`
  return {
    selectionEnd: start,
    selectionStart: start,
    value: nextValue,
  }
}

function findAtomicSkillTokenRanges(
  value: string,
  skillReferences: ReadonlySet<string>
): SkillTokenRange[] {
  if (!value || skillReferences.size === 0) {
    return []
  }

  const pattern = /(^|[\s([{])(\$[a-z0-9:-]+)/gi
  const ranges: SkillTokenRange[] = []

  for (const match of value.matchAll(pattern)) {
    const prefix = match[1] ?? ""
    const token = match[2] ?? ""
    const matchIndex = match.index ?? 0
    const reference = normalizeSkillReference(token.slice(1))
    if (!reference || !skillReferences.has(reference)) {
      continue
    }
    const start = matchIndex + prefix.length
    ranges.push({
      end: start + token.length,
      reference,
      start,
    })
  }

  return ranges
}

function clampSelectionIndex(value: string, index: number) {
  return Math.max(0, Math.min(index, value.length))
}

function normalizeSkillReference(value?: string) {
  return (value ?? "").trim().toLowerCase()
}
