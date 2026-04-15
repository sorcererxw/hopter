import { ArrowUp, Square } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SessionActionBar({
  input,
  onInputChange,
  onSubmit,
  onInterrupt,
  error,
  stickyOnMobile = false,
}: {
  input: string;
  onInputChange: (next: string) => void;
  onSubmit: () => Promise<void>;
  onInterrupt: () => Promise<void>;
  error?: string | null;
  stickyOnMobile?: boolean;
}) {
  return (
    <div className={stickyOnMobile ? "sticky bottom-3 z-20 md:bottom-4" : "sticky bottom-3 z-20"}>
      <form
        className="rounded-[26px] border border-border bg-card/95 p-3 shadow-xl backdrop-blur"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        <textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          rows={3}
          placeholder="Reply to Codex, steer the session, or tell it what to do next."
          className="min-h-[110px] w-full resize-none rounded-[20px] border border-input bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/60"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" className="rounded-2xl">
              <ArrowUp className="size-4" />
              Send
            </Button>
            <Button type="button" variant="secondary" className="rounded-2xl" onClick={() => void onInterrupt()}>
              <Square className="size-4" />
              Interrupt
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </form>
    </div>
  );
}
