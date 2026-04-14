export type ArtifactRef = {
  id: string;
  sessionId: string;
  kind: string;
  label: string;
  path: string;
  contentType: string;
  sizeBytes: number;
  inlineContent: boolean;
  createdAt: string;
};
