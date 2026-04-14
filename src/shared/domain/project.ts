export type ProjectBinding = {
  id: string;
  name: string;
  repoPath: string;
  hostId: string;
  defaultBackend: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectBindingHealth = {
  status: "healthy" | "degraded" | "unhealthy";
  repoExists: boolean;
  backendAvailable: boolean;
};

export type Project = ProjectBinding;
export type ProjectHealth = ProjectBindingHealth;
