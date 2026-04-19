import { useState } from "react";

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--color-border)] bg-black/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2">
          <svg
            width="24"
            height="24"
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
          <span className="text-lg font-semibold tracking-tight text-white">
            Hopter
          </span>
        </a>

        {/* Desktop Nav */}
        <div className="hidden items-center gap-8 md:flex">
          <a
            href="#features"
            className="text-sm text-[var(--color-muted)] transition-colors hover:text-white"
          >
            Features
          </a>
          <a
            href="#how-it-works"
            className="text-sm text-[var(--color-muted)] transition-colors hover:text-white"
          >
            How It Works
          </a>
          <a
            href="https://github.com/sorcererxw/hopter"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--color-muted)] transition-colors hover:text-white"
          >
            GitHub
          </a>
          <a
            href="https://github.com/sorcererxw/hopter"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center rounded-full border border-[var(--color-border-strong)] bg-white px-4 text-sm font-medium text-black transition-all hover:bg-gray-200"
          >
            Get Started
          </a>
        </div>

        {/* Mobile menu button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="flex items-center justify-center md:hidden"
          aria-label="Toggle menu"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-white"
          >
            {mobileMenuOpen ? (
              <path d="M6 6l12 12M6 18L18 6" />
            ) : (
              <path d="M4 8h16M4 16h16" />
            )}
          </svg>
        </button>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="border-t border-[var(--color-border)] bg-black px-6 py-4 md:hidden">
          <div className="flex flex-col gap-4">
            <a
              href="#features"
              className="text-sm text-[var(--color-muted)] transition-colors hover:text-white"
              onClick={() => setMobileMenuOpen(false)}
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="text-sm text-[var(--color-muted)] transition-colors hover:text-white"
              onClick={() => setMobileMenuOpen(false)}
            >
              How It Works
            </a>
            <a
              href="https://github.com/sorcererxw/hopter"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--color-muted)] transition-colors hover:text-white"
            >
              GitHub
            </a>
            <a
              href="https://github.com/sorcererxw/hopter"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 w-fit items-center rounded-full border border-[var(--color-border-strong)] bg-white px-4 text-sm font-medium text-black"
            >
              Get Started
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
