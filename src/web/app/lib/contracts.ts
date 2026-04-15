export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type AuthMe = {
  authenticated: boolean;
  required: boolean;
  user: { id: string; mode: string } | null;
};

export type HostStatus = {
  hostId: string;
  status: string;
  codex: {
    detected: boolean;
    version: string | null;
    compatible: boolean;
    status: string;
    reason: string | null;
  };
  storage: {
    artifacts: string;
  };
  accessMode: string;
};

export type HostFsRoots = { items: string[] };

export type HostFsRecentRepo = {
  path: string;
  name: string;
};

export type HostFsList = {
  currentPath: string;
  parentPath: string | null;
  roots: string[];
  entries: Array<{
    name: string;
    path: string;
    isRepo: boolean;
    hasChildren: boolean;
  }>;
};

export type ProjectBindingView = {
  id: string;
  name: string;
  repoPath: string;
  defaultBackend: string;
};

export type ProjectDetail = {
  binding: ProjectBindingView;
  health: {
    status: string;
    repoExists: boolean;
    backendAvailable: boolean;
  };
};

export type BackendSessionView = {
  id: string;
  projectId: string;
  title: string | null;
  status: string;
  lastSummary: string | null;
  attentionReason: string | null;
  degraded: boolean;
  backendSessionId: string | null;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionDetail = {
  handle: BackendSessionView;
  attention: {
    reason: string;
    headline: string;
  } | null;
  latestSummary: string | null;
  artifacts: Array<{
    id: string;
    kind: string;
    label: string;
    inlineContent: boolean;
    contentType: string;
  }>;
  terminal: {
    available: boolean;
  };
};

export type ArtifactDetail = {
  artifact: {
    id: string;
    label: string;
    kind: string;
    inlineContent: boolean;
  };
  content?: string;
  downloadUrl?: string;
};

export type ShellSessionItem = BackendSessionView & {
  context: ProjectBindingView;
};
