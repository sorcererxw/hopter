const steps = [
  {
    step: "01",
    title: "Install Hopter",
    description:
      "Install the Hopter binary on your development machine via Homebrew or direct download.",
    code: "brew install hopter",
  },
  {
    step: "02",
    title: "Start the Server",
    description:
      "Launch the Hopter gateway. It automatically detects and connects to your installed coding agents like Codex.",
    code: "hopter start",
  },
  {
    step: "03",
    title: "Open From Any Device",
    description:
      "Access the web UI from your phone, tablet, or any browser. Create sessions, review plans, and approve changes on the go.",
    code: "→ http://localhost:8787",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="px-6 py-32">
      <div className="mx-auto max-w-4xl">
        {/* Section header */}
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Up and running in minutes
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-[var(--color-muted)]">
            Three steps to connect your coding agents to every device.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-12">
          {steps.map((item, index) => (
            <div
              key={item.step}
              className="relative flex gap-8"
            >
              {/* Step connector line */}
              {index < steps.length - 1 && (
                <div className="absolute top-14 left-[23px] h-[calc(100%-20px)] w-px bg-[var(--color-border)]" />
              )}

              {/* Step number */}
              <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] font-mono text-sm font-medium text-[var(--color-accent)]">
                {item.step}
              </div>

              {/* Content */}
              <div className="flex-1 pb-4">
                <h3 className="mb-2 text-xl font-semibold text-white">
                  {item.title}
                </h3>
                <p className="mb-4 text-[var(--color-muted)]">
                  {item.description}
                </p>
                <div className="inline-block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 font-mono text-sm text-[var(--color-muted-foreground)]">
                  {item.code}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
