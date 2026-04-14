import { type DependencyList, useEffect, useState } from "react";

export function usePolling<T>(loader: () => Promise<T>, deps: DependencyList, intervalMs = 3_000) {
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

  return {
    data,
    error,
    loading,
    refresh: async () => setData(await loader()),
  };
}

export function useRealtimeVersion() {
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
        retryTimer = window.setTimeout(connect, 1_500);
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
