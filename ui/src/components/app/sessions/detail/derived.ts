// Pull likely file references out of review text so the inspector can label the
// associated artifact view with something more specific than "summary.md".
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
