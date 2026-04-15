import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import type { HostStatus, ProjectBindingView, BackendSessionView, ShellSessionItem } from "@/lib/contracts";

const POLL_INTERVAL_MS = 4_000;

function sortSessions(items: ShellSessionItem[]) {
  return [...items].sort((a, b) => {
    const aTime = Date.parse(a.lastEventAt ?? a.updatedAt ?? a.createdAt ?? "") || 0;
    const bTime = Date.parse(b.lastEventAt ?? b.updatedAt ?? b.createdAt ?? "") || 0;
    return bTime - aTime;
  });
}

export function useShellNavigationData() {
  const [host, setHost] = useState<HostStatus | null>(null);
  const [contexts, setContexts] = useState<ProjectBindingView[]>([]);
  const [sessions, setSessions] = useState<ShellSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const load = async () => {
      try {
        const [hostStatus, bindingResponse] = await Promise.all([
          api.get<HostStatus>("/api/host/status"),
          api.get<{ items: ProjectBindingView[] }>("/api/bindings"),
        ]);

        const nextContexts = bindingResponse.items;
        const sessionGroups = await Promise.all(
          nextContexts.map(async (context) => {
            try {
              const response = await api.get<{ items: BackendSessionView[] }>(`/api/bindings/${context.id}/backend-sessions`);
              return response.items.map((session) => ({ ...session, context } satisfies ShellSessionItem));
            } catch {
              return [] as ShellSessionItem[];
            }
          }),
        );

        if (cancelled) {
          return;
        }

        setHost(hostStatus);
        setContexts(nextContexts);
        setSessions(sortSessions(sessionGroups.flat()));
        setError(null);
        setLoading(false);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setLoading(false);
      }
    };

    void load();
    intervalId = window.setInterval(load, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, []);

  const attentionSessions = useMemo(
    () => sessions.filter((session) => Boolean(session.attentionReason) || session.degraded),
    [sessions],
  );

  const activeSessions = useMemo(
    () => sessions.filter((session) => ["running", "waiting_approval", "waiting_input", "degraded"].includes(session.status)),
    [sessions],
  );

  const recentSessions = useMemo(() => sessions.slice(0, 24), [sessions]);

  return {
    host,
    contexts,
    sessions,
    recentSessions,
    attentionSessions,
    activeSessions,
    loading,
    error,
  };
}
