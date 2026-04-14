import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../static/app.css";

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

type AuthMe = {
  authenticated: boolean;
  required: boolean;
  user: { id: string; mode: string } | null;
};

type HostStatus = {
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
    db: string;
    artifacts: string;
  };
  accessMode: string;
};

type Project = {
  id: string;
  name: string;
  repoPath: string;
  defaultBackend: string;
};

type ProjectDetail = {
  project: Project;
  health: {
    status: string;
    repoExists: boolean;
    backendAvailable: boolean;
  };
};

type Session = {
  id: string;
  projectId: string;
  title: string | null;
  status: string;
  lastSummary: string | null;
  attentionReason: string | null;
  degraded: boolean;
  backendSessionId: string | null;
};

type SessionDetail = {
  session: Session;
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

type ArtifactDetail = {
  artifact: {
    id: string;
    label: string;
    kind: string;
    inlineContent: boolean;
  };
  content?: string;
  downloadUrl?: string;
};

class ApiClient {
  async request<T>(input: string, init?: RequestInit): Promise<T> {
    const response = await fetch(input, {
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...init,
    });
    const payload = await response.json() as ApiResponse<T>;
    if (!payload.ok) {
      throw new Error(payload.error.message);
    }

    return payload.data;
  }

  get<T>(input: string): Promise<T> {
    return this.request<T>(input);
  }

  post<T>(input: string, body?: unknown): Promise<T> {
    return this.request<T>(input, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  patch<T>(input: string, body: unknown): Promise<T> {
    return this.request<T>(input, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }
}

const api = new ApiClient();

function usePathname(): [string, (next: string) => void] {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (next: string) => {
    window.history.pushState({}, "", next);
    setPathname(next);
  };

  return [pathname, navigate];
}

function usePolling<T>(loader: () => Promise<T>, deps: React.DependencyList, intervalMs = 3_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const run = async () => {
      try {
        const result = await loader();
        if (!cancelled) {
          setData(result);
          setError(null);
          setLoading(false);
        }
      } catch (loaderError) {
        if (!cancelled) {
          setError(loaderError instanceof Error ? loaderError.message : String(loaderError));
          setLoading(false);
        }
      }
    };

    void run();
    intervalId = window.setInterval(run, intervalMs);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, deps);

  return { data, error, loading, refresh: async () => setData(await loader()) };
}

function useRealtimeVersion() {
  const [version, setVersion] = useState(0);
  const [connectionState, setConnectionState] = useState<"connecting" | "live" | "reconnecting">("connecting");

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;

    const connect = () => {
      setConnectionState((current) => current === "live" ? "reconnecting" : "connecting");
      socket = new WebSocket(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`);

      socket.addEventListener("open", () => {
        setConnectionState("live");
      });

      socket.addEventListener("message", () => {
        setVersion((current) => current + 1);
      });

      socket.addEventListener("close", () => {
        setConnectionState("reconnecting");
        retryTimer = window.setTimeout(connect, 1500);
      });
    };

    connect();

    return () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      socket?.close();
    };
  }, []);

  return { version, connectionState };
}

function Link(props: { to: string; navigate: (path: string) => void; children: React.ReactNode; className?: string }) {
  return (
    <a
      href={props.to}
      className={props.className}
      onClick={(event) => {
        event.preventDefault();
        props.navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}

function Shell(props: {
  navigate: (path: string) => void;
  auth: AuthMe;
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">orchd</p>
          <h1 className="sidebar-title">Remote control plane</h1>
          <p className="sidebar-copy">Status first. Summary second. Attention before terminal.</p>
        </div>
        <nav className="sidebar-nav">
          <Link to="/" navigate={props.navigate}>Dashboard</Link>
          <Link to="/projects/new" navigate={props.navigate}>Create project</Link>
          <Link to="/settings" navigate={props.navigate}>Settings</Link>
        </nav>
        <div className="sidebar-footer">
          <span>{props.auth.user?.id ?? "guest"}</span>
          {props.auth.required ? (
            <button
              className="button secondary logout-button"
              onClick={async () => {
                await api.post("/api/auth/logout");
                window.location.reload();
              }}
            >
              Sign out
            </button>
          ) : null}
        </div>
      </aside>
      <main className="main-content">{props.children}</main>
    </div>
  );
}

function LoginPage(props: { onLoggedIn: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <main className="centered-page">
      <section className="card auth-card">
        <p className="eyebrow">orchd</p>
        <h1>Sign in</h1>
        <p>Single-user password auth protects remote control actions when enabled.</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setSubmitting(true);
            setError(null);
            try {
              await api.post("/api/auth/login", { password });
              await props.onLoggedIn();
            } catch (loginError) {
              setError(loginError instanceof Error ? loginError.message : String(loginError));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="button primary" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </section>
    </main>
  );
}

function DashboardPage(props: { navigate: (path: string) => void }) {
  const realtime = useRealtimeVersion();
  const { data: host } = usePolling(() => api.get<HostStatus>("/api/host/status"), [realtime.version]);
  const { data: projects } = usePolling(() => api.get<{ items: Project[] }>("/api/projects"), [realtime.version]);
  const [sessionGroups, setSessionGroups] = useState<Array<{ project: Project; sessions: Session[] }>>([]);

  useEffect(() => {
    if (!projects?.items) return;
    let cancelled = false;
    void Promise.all(
      projects.items.map(async (project) => ({
        project,
        sessions: (await api.get<{ items: Session[] }>(`/api/projects/${project.id}/sessions`)).items,
      })),
    ).then((groups) => {
      if (!cancelled) {
        setSessionGroups(groups);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projects?.items?.map((project) => project.id).join(","), realtime.version]);

  const runningSessions = useMemo(
    () => sessionGroups.flatMap((group) => group.sessions.filter((session) => session.status === "running").map((session) => ({ ...session, projectName: group.project.name }))),
    [sessionGroups],
  );
  const attentionSessions = useMemo(
    () => sessionGroups.flatMap((group) => group.sessions.filter((session) => session.attentionReason).map((session) => ({ ...session, projectName: group.project.name }))),
    [sessionGroups],
  );

  return (
    <section className="page-grid">
      {realtime.connectionState !== "live" ? <div className="connection-banner full-width">Realtime {realtime.connectionState}. Falling back to HTTP refresh.</div> : null}
      <article className="card hero-card">
        <p className="eyebrow">Host</p>
        <h2>{host?.status ?? "Loading host…"}</h2>
        <p>
          Codex {host?.codex.detected ? host.codex.version : "missing"} · access {host?.accessMode ?? "—"}
        </p>
      </article>
      <article className="card">
        <h3>Attention now</h3>
        {attentionSessions.length === 0 ? <p className="muted">No sessions need you right now.</p> : (
          <ul className="stack-list">
            {attentionSessions.map((session) => (
              <li key={session.id}>
                <button className="list-button" onClick={() => props.navigate(`/sessions/${session.id}`)}>
                  <strong>{session.title ?? session.projectName}</strong>
                  <span>{session.attentionReason}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
      <article className="card">
        <h3>Running sessions</h3>
        {runningSessions.length === 0 ? <p className="muted">No active sessions.</p> : (
          <ul className="stack-list">
            {runningSessions.map((session) => (
              <li key={session.id}>
                <button className="list-button" onClick={() => props.navigate(`/sessions/${session.id}`)}>
                  <strong>{session.title ?? session.projectName}</strong>
                  <span>{session.lastSummary ?? session.status}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
      <article className="card full-width">
        <div className="section-header">
          <h3>Projects</h3>
          <button className="button secondary" onClick={() => props.navigate("/projects/new")}>Add project</button>
        </div>
        {!projects?.items?.length ? <p className="muted">No projects yet. Create one from a local repo path.</p> : (
          <ul className="project-grid">
            {projects.items.map((project) => (
              <li key={project.id} className="project-card">
                <button className="project-link" onClick={() => props.navigate(`/projects/${project.id}`)}>
                  <strong>{project.name}</strong>
                  <span>{project.repoPath}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}

function ProjectCreatePage(props: { navigate: (path: string) => void }) {
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <section className="card page-card">
      <p className="eyebrow">Project</p>
      <h2>Create project</h2>
      <p>Bind one local repo path to the thin control plane. `orchd` stores the binding, not the repo contents.</p>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setSubmitting(true);
          setError(null);
          try {
            const result = await api.post<{ project: Project }>("/api/projects", {
              name,
              repoPath,
              defaultBackend: "codex",
            });
            props.navigate(`/projects/${result.project.id}`);
          } catch (submissionError) {
            setError(submissionError instanceof Error ? submissionError.message : String(submissionError));
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="orchd" />
        </label>
        <label className="field">
          <span>Repo path</span>
          <input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} placeholder="/Users/me/src/orchd" />
        </label>
        <label className="field">
          <span>Backend</span>
          <input value="codex" disabled />
        </label>
        <button className="button primary" disabled={submitting}>{submitting ? "Creating…" : "Create project"}</button>
        {error ? <p className="error-text">{error}</p> : null}
      </form>
    </section>
  );
}

function ProjectDetailPage(props: { projectId: string; navigate: (path: string) => void }) {
  const realtime = useRealtimeVersion();
  const { data: project } = usePolling(() => api.get<ProjectDetail>(`/api/projects/${props.projectId}`), [props.projectId, realtime.version]);
  const { data: sessions } = usePolling(() => api.get<{ items: Session[] }>(`/api/projects/${props.projectId}/sessions`), [props.projectId, realtime.version]);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="page-grid">
      {realtime.connectionState !== "live" ? <div className="connection-banner full-width">Realtime {realtime.connectionState}. HTTP refetch is active.</div> : null}
      <article className="card hero-card">
        <p className="eyebrow">Project</p>
        <h2>{project?.project.name ?? "Loading…"}</h2>
        <p>{project?.project.repoPath}</p>
        <span className={`status-pill ${project?.health.status ?? "idle"}`}>{project?.health.status ?? "…"}</span>
      </article>
      <article className="card full-width">
        <div className="section-header">
          <h3>Start session</h3>
        </div>
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            try {
              const result = await api.post<{ session: Session }>(`/api/projects/${props.projectId}/sessions`, { title, prompt });
              props.navigate(`/sessions/${result.session.id}`);
            } catch (submissionError) {
              setError(submissionError instanceof Error ? submissionError.message : String(submissionError));
            }
          }}
        >
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Investigate reconnect behavior" />
          </label>
          <label className="field">
            <span>Prompt</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} placeholder="Trace the reconnect path and harden degraded-state handling." />
          </label>
          <button className="button primary">Start session</button>
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </article>
      <article className="card full-width">
        <h3>Sessions</h3>
        {!sessions?.items?.length ? <p className="muted">No sessions yet.</p> : (
          <ul className="stack-list">
            {sessions.items.map((session) => (
              <li key={session.id}>
                <button className="list-button" onClick={() => props.navigate(`/sessions/${session.id}`)}>
                  <strong>{session.title ?? session.id}</strong>
                  <span>{session.status} · {session.lastSummary ?? "No summary yet"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}

function SessionDetailPage(props: { sessionId: string }) {
  const realtime = useRealtimeVersion();
  const { data: detail, error, loading } = usePolling(() => api.get<SessionDetail>(`/api/sessions/${props.sessionId}`), [props.sessionId, realtime.version], 4_000);
  const [artifactDetail, setArtifactDetail] = useState<ArtifactDetail | null>(null);
  const [input, setInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!detail?.artifacts?.length) {
      setArtifactDetail(null);
      return;
    }

    void api.get<ArtifactDetail>(`/api/artifacts/${detail.artifacts[0].id}`).then(setArtifactDetail).catch(() => setArtifactDetail(null));
  }, [detail?.artifacts?.map((artifact) => artifact.id).join(",")]);

  if (loading && !detail) {
    return <section className="card page-card"><p>Loading session…</p></section>;
  }

  if (error) {
    return <section className="card page-card"><p className="error-text">{error}</p></section>;
  }

  if (!detail) {
    return null;
  }

  return (
    <section className="session-layout">
      {realtime.connectionState !== "live" ? <div className="connection-banner full-width">Session is reconnecting. Visible state may be stale until HTTP refetch succeeds.</div> : null}
      <article className="card session-hero">
        <div className="session-topline">
          <p className="eyebrow">Session</p>
          <span className={`status-pill ${detail.session.status}`}>{detail.session.status}</span>
        </div>
        <h2>{detail.session.title ?? detail.session.id}</h2>
        <p className="muted">Backend thread {detail.session.backendSessionId ?? "pending"}</p>
      </article>

      <article className="card">
        <h3>Status</h3>
        <p>{detail.session.degraded ? "Degraded: live attachment truth is reduced." : "Live session state is current."}</p>
      </article>

      <article className="card">
        <h3>Latest summary</h3>
        <p>{detail.latestSummary ?? "No summary yet."}</p>
      </article>

      <article className="card">
        <h3>Attention</h3>
        {detail.attention ? (
          <div className="attention-card">
            <strong>{detail.attention.headline}</strong>
            <span>{detail.attention.reason}</span>
            <div className="button-row">
              <button className="button primary" onClick={async () => {
                setActionError(null);
                try {
                  await api.post(`/api/sessions/${props.sessionId}/approve`, { decision: "approve", note: null });
                } catch (approveError) {
                  setActionError(approveError instanceof Error ? approveError.message : String(approveError));
                }
              }}>Approve</button>
              <button className="button secondary" onClick={async () => {
                setActionError(null);
                try {
                  await api.post(`/api/sessions/${props.sessionId}/approve`, { decision: "reject", note: null });
                } catch (rejectError) {
                  setActionError(rejectError instanceof Error ? rejectError.message : String(rejectError));
                }
              }}>Reject</button>
            </div>
          </div>
        ) : <p className="muted">No action required.</p>}
      </article>

      <article className="card full-width">
        <h3>Action bar</h3>
        <form className="action-form" onSubmit={async (event) => {
          event.preventDefault();
          setActionError(null);
          try {
            await api.post(`/api/sessions/${props.sessionId}/input`, { text: input });
            setInput("");
          } catch (inputError) {
            setActionError(inputError instanceof Error ? inputError.message : String(inputError));
          }
        }}>
          <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={3} placeholder="Do not refactor unrelated files. Focus on reconnect handling." />
          <div className="button-row">
            <button className="button primary">Send input</button>
            <button
              type="button"
              className="button secondary"
              onClick={async () => {
                setActionError(null);
                try {
                  await api.post(`/api/sessions/${props.sessionId}/interrupt`, { mode: "interrupt" });
                } catch (interruptError) {
                  setActionError(interruptError instanceof Error ? interruptError.message : String(interruptError));
                }
              }}
            >
              Interrupt
            </button>
          </div>
          {actionError ? <p className="error-text">{actionError}</p> : null}
        </form>
      </article>

      <article className="card">
        <h3>Artifacts</h3>
        {!detail.artifacts.length ? <p className="muted">No artifacts yet.</p> : (
          <ul className="stack-list">
            {detail.artifacts.map((artifact) => (
              <li key={artifact.id}>
                <button className="list-button" onClick={async () => setArtifactDetail(await api.get<ArtifactDetail>(`/api/artifacts/${artifact.id}`))}>
                  <strong>{artifact.label}</strong>
                  <span>{artifact.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="card">
        <h3>Artifact viewer</h3>
        {artifactDetail?.content ? <pre>{artifactDetail.content}</pre> : <p className="muted">Select an artifact to inspect it.</p>}
      </article>

      <article className="card full-width">
        <h3>Timeline</h3>
        <p className="muted">Timeline stays compact by default. Raw event drill-down lands in the next slice.</p>
      </article>

      <article className="card full-width terminal-card">
        <h3>Terminal drawer</h3>
        <p className="muted">Secondary surface only. Present, but intentionally visually subordinate to status, summary, attention, and artifacts.</p>
      </article>
    </section>
  );
}

function SettingsPage() {
  const { data: host } = usePolling(() => api.get<HostStatus>("/api/host/status"), []);
  return (
    <section className="page-grid">
      <article className="card">
        <h3>Host health</h3>
        <pre>{JSON.stringify(host, null, 2)}</pre>
      </article>
    </section>
  );
}

function App() {
  const [pathname, navigate] = usePathname();
  const [auth, setAuth] = useState<AuthMe | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshAuth = async () => {
    try {
      const next = await api.get<AuthMe>("/api/auth/me");
      setAuth(next);
      setAuthError(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void refreshAuth();
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  if (!auth) {
    return <main className="centered-page"><section className="card"><p>{authError ?? "Booting orchd…"}</p></section></main>;
  }

  if (auth.required && !auth.authenticated) {
    return <LoginPage onLoggedIn={refreshAuth} />;
  }

  let page: React.ReactNode;
  if (pathname === "/") {
    page = <DashboardPage navigate={navigate} />;
  } else if (pathname === "/projects/new") {
    page = <ProjectCreatePage navigate={navigate} />;
  } else if (pathname.startsWith("/projects/")) {
    page = <ProjectDetailPage projectId={pathname.split("/")[2]!} navigate={navigate} />;
  } else if (pathname.startsWith("/sessions/")) {
    page = <SessionDetailPage sessionId={pathname.split("/")[2]!} />;
  } else if (pathname === "/settings") {
    page = <SettingsPage />;
  } else {
    page = <section className="card page-card"><p>Page not found.</p></section>;
  }

  return <Shell navigate={navigate} auth={auth}>{page}</Shell>;
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
