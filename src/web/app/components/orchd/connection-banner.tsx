import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ConnectionBanner({
  state,
  messageWhenDegraded,
}: {
  state: "connecting" | "live" | "reconnecting";
  messageWhenDegraded: string;
}) {
  if (state === "live") {
    return null;
  }

  return (
    <Alert variant="warning">
      <AlertTitle>Realtime {state}</AlertTitle>
      <AlertDescription>{messageWhenDegraded}</AlertDescription>
    </Alert>
  );
}
