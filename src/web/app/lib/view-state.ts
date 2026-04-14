export function resolveSelectedArtifactId(
  artifactIds: string[],
  current: string | null,
): string | null {
  if (artifactIds.length === 0) {
    return null;
  }

  if (current && artifactIds.includes(current)) {
    return current;
  }

  return artifactIds[0] ?? null;
}
