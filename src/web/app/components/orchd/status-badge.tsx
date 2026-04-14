import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const variant = normalized === "running" || normalized === "healthy" || normalized === "completed"
    ? "success"
    : normalized === "waiting_approval" || normalized === "degraded"
      ? "warning"
      : normalized === "failed" || normalized === "error"
        ? "destructive"
        : "outline";

  return <Badge variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}
