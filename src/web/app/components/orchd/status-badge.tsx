import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";

export function getStatusBadgeVariant(status: string): NonNullable<BadgeProps["variant"]> {
  const normalized = status.toLowerCase();
  return ["running", "healthy", "completed"].includes(normalized)
    ? "success"
    : ["waiting_approval", "waiting_input", "degraded", "reconnecting"].includes(normalized)
      ? "warning"
      : ["failed", "error"].includes(normalized)
        ? "destructive"
        : "outline";
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={getStatusBadgeVariant(status)}>{status.replaceAll("_", " ")}</Badge>;
}
