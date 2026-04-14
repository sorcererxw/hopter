import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TimelinePanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Timeline stays compact by default. Raw event drill-down lands in the next slice.</p>
      </CardContent>
    </Card>
  );
}
