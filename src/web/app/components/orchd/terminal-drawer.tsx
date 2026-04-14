import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TerminalDrawer() {
  return (
    <Card className="border-dashed bg-muted/30">
      <CardHeader>
        <CardTitle>Terminal drawer</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Secondary surface only. Present, but intentionally visually subordinate to status, summary, attention, and artifacts.</p>
      </CardContent>
    </Card>
  );
}
