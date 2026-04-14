import { PageHero } from "@/components/orchd/page-hero";
import { StatusBadge } from "@/components/orchd/status-badge";

export function SessionHero({ title, backendSessionId, status }: { title: string; backendSessionId: string | null; status: string }) {
  return (
    <PageHero
      eyebrow="Backend session"
      title={title}
      description={`Backend thread ${backendSessionId ?? "pending"}`}
      status={<StatusBadge status={status} />}
    />
  );
}
