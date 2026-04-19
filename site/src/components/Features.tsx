const features = [
  {
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
    title: "Your Machine, Your Context",
    description:
      "Runs on your own machine where your repos, tools, secrets, and agent configurations already live. No cloud VM, no context duplication.",
  },
  {
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <path d="M12 18h.01" />
      </svg>
    ),
    title: "Work From Any Device",
    description:
      "Open the web UI from your phone, tablet, or any browser. Continue right where you left off with full session context.",
  },
  {
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
    title: "Backend Agnostic",
    description:
      "Built with an adapter framework from day one. Start with Codex, expand to Claude Code, OpenCode, and more.",
  },
  {
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M9 12l2 2 4-4" />
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
      </svg>
    ),
    title: "Approval-First Workflow",
    description:
      "Review plans, approve changes, and stay in control. The agent explains what it will do and waits for your go-ahead.",
  },
  {
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: "Private & Secure",
    description:
      "Everything stays on your machine. No code leaves your network. Localhost-only auth with optional relay for remote access.",
  },
  {
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
    title: "Open Source",
    description:
      "Apache 2.0 licensed. Inspect every line, self-host with confidence, and contribute to the project.",
  },
];

export function Features() {
  return (
    <section id="features" className="px-6 py-32">
      <div className="mx-auto max-w-6xl">
        {/* Section header */}
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Built for real workflows
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-[var(--color-muted)]">
            Not another cloud IDE. A lightweight control plane that connects
            your existing coding agents to every device you own.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 transition-all hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-elevated)]"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-surface-elevated)] text-[var(--color-accent)] group-hover:bg-[var(--color-accent)]/10">
                {feature.icon}
              </div>
              <h3 className="mb-2 text-base font-semibold text-white">
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed text-[var(--color-muted)]">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
