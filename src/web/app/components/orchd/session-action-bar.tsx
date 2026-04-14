import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export function SessionActionBar({
  input,
  onInputChange,
  onSubmit,
  onInterrupt,
  error,
}: {
  input: string;
  onInputChange: (next: string) => void;
  onSubmit: () => Promise<void>;
  onInterrupt: () => Promise<void>;
  error?: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Action bar</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <Textarea
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            rows={3}
            placeholder="Do not refactor unrelated files. Focus on reconnect handling."
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Send input</Button>
            <Button type="button" variant="secondary" onClick={() => void onInterrupt()}>
              Interrupt
            </Button>
          </div>
          {error ? <p className="text-sm text-red-200">{error}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
