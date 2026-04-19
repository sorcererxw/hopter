const footerLinks = {
  Product: [
    { label: "Features", href: "#features" },
    { label: "How It Works", href: "#how-it-works" },
    { label: "Documentation", href: "https://github.com/sorcererxw/hopter#readme" },
  ],
  Community: [
    { label: "GitHub", href: "https://github.com/sorcererxw/hopter" },
    { label: "Issues", href: "https://github.com/sorcererxw/hopter/issues" },
    { label: "Discussions", href: "https://github.com/sorcererxw/hopter/discussions" },
  ],
  Legal: [
    { label: "License (Apache 2.0)", href: "https://github.com/sorcererxw/hopter/blob/main/LICENSE" },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-[var(--color-border)] px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div>
            <div className="mb-4 flex items-center gap-2">
              <svg
                width="20"
                height="20"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect width="32" height="32" rx="8" fill="#0070F3" />
                <text
                  x="16"
                  y="22"
                  textAnchor="middle"
                  fontFamily="Inter, sans-serif"
                  fontWeight="700"
                  fontSize="18"
                  fill="white"
                >
                  H
                </text>
              </svg>
              <span className="font-semibold text-white">Hopter</span>
            </div>
            <p className="text-sm leading-relaxed text-[var(--color-muted)]">
              Remote control plane for
              <br />
              your local coding agents.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="mb-4 text-sm font-semibold text-white">
                {category}
              </h4>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.href.startsWith("http") ? "_blank" : undefined}
                      rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="text-sm text-[var(--color-muted)] transition-colors hover:text-white"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-[var(--color-border)] pt-8 sm:flex-row">
          <p className="text-sm text-[var(--color-muted)]">
            © {new Date().getFullYear()} Hopter. All rights reserved.
          </p>
          <p className="text-sm text-[var(--color-muted)]">
            Built with{" "}
            <a
              href="https://astro.build"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-muted-foreground)] transition-colors hover:text-white"
            >
              Astro
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
