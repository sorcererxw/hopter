export type GatewayEvent = {
  id: string;
  scope: "dashboard" | "project" | "session" | "terminal" | "host";
  scopeId: string | null;
  type: string;
  ts: string;
  payload: Record<string, unknown>;
};

export class EventHub {
  private readonly listeners = new Set<(event: GatewayEvent) => void>();

  subscribe(listener: (event: GatewayEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: Omit<GatewayEvent, "id" | "ts">): GatewayEvent {
    const fullEvent: GatewayEvent = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      ...event,
    };

    for (const listener of this.listeners) {
      listener(fullEvent);
    }

    return fullEvent;
  }
}
