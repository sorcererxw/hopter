export type Project = {
  id: string;
  name: string;
  repoPath: string;
  hostId: string;
  defaultBackend: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectHealth = {
  status: "healthy" | "degraded" | "unhealthy";
  repoExists: boolean;
  backendAvailable: boolean;
};
