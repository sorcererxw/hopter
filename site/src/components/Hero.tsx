export function Hero() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pt-16">
      {/* Gradient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(0,112,243,0.15),transparent_70%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        {/* Badge */}
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5 text-sm text-[var(--color-muted-foreground)]">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]" />
          Open Source — Apache 2.0
        </div>

        {/* Headline */}
        <h1 className="mb-6 text-5xl leading-[1.1] font-bold tracking-tight text-white sm:text-6xl md:text-7xl">
          Your Coding Agent,
          <br />
          <span className="bg-gradient-to-r from-[var(--color-accent)] to-blue-400 bg-clip-text text-transparent">
            From Anywhere
          </span>
        </h1>

        {/* Subtitle */}
        <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-[var(--color-muted)] sm:text-xl">
          Hopter is a self-hosted remote control plane for your local coding
          agents. Continue working from your phone, laptop, or any browser —
          same machine, same context.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href="https://github.com/sorcererxw/hopter"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-8 text-base font-medium text-black transition-all hover:bg-gray-200"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            View on GitHub
          </a>
          <a
            href="#how-it-works"
            className="inline-flex h-12 items-center gap-2 rounded-full border border-[var(--color-border-strong)] px-8 text-base font-medium text-white transition-all hover:border-white/40 hover:bg-white/5"
          >
            Learn More
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4 8h8M9 4l4 4-4 4" />
            </svg>
          </a>
        </div>

        {/* Terminal preview */}
        <div className="mx-auto mt-20 max-w-3xl">
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {/* Terminal header */}
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
              <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <div className="h-3 w-3 rounded-full bg-[#28c840]" />
              <span className="ml-2 font-mono text-xs text-[var(--color-muted)]">
                Terminal
              </span>
            </div>
            {/* Terminal body */}
            <div className="p-6 font-mono text-sm leading-relaxed">
              <div className="text-[var(--color-muted)]">
                <span className="text-green-400">$</span> brew install hopter
              </div>
              <div className="mt-2 text-[var(--color-muted)]">
                <span className="text-green-400">$</span> hopter start
              </div>
              <div className="mt-2 text-[var(--color-muted-foreground)]">
                ✓ Server started on{" "}
                <span className="text-[var(--color-accent)]">
                  http://localhost:8787
                </span>
              </div>
              <div className="text-[var(--color-muted-foreground)]">
                ✓ Codex backend detected and connected
              </div>
              <div className="text-[var(--color-muted-foreground)]">
                ✓ Web UI available — open from any device
              </div>
              <div className="mt-3 text-[var(--color-muted)]">
                <span className="text-green-400">$</span>{" "}
                <span className="animate-pulse">▊</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
