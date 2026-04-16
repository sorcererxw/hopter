export function parseReferencedFiles(text: string) {
  const matches = text.match(/`([^`]+\.(?:ts|tsx|js|jsx|go|proto|md)(?:#[^`]+)?)`/g) ?? []
  const values = matches
    .map((match) => match.slice(1, -1))
    .filter((value) => !value.includes("*"))

  return [...new Set(values)]
}

export function deriveReviewLabel(text: string) {
  const firstReference = parseReferencedFiles(text)[0]

  if (!firstReference) {
    return "summary.md"
  }

  const hashIndex = firstReference.indexOf("#")
  return hashIndex >= 0 ? firstReference.slice(0, hashIndex) : firstReference
}
