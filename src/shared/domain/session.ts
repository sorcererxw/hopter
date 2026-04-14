export type BackendSessionHandle = {
  id: string;
  projectId: string;
  backend: string;
  backendSessionId: string | null;
  title: string | null;
  status: string;
  lastSummary: string | null;
  attentionReason: string | null;
  degraded: boolean;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionRef = BackendSessionHandle;
