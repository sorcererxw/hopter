import { Fragment } from "react"

import { cn } from "@/lib/utils"

type SessionRichTextProps = {
  text: string
  className?: string
}

export function SessionRichText({ className, text }: SessionRichTextProps) {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  const isLongForm = blocks.length > 3

  return (
    <div
      className={cn(
        "text-base leading-7 font-medium text-foreground",
        isLongForm ? "space-y-4" : "space-y-2.5",
        className
      )}
    >
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trimEnd())
        const isList = lines.every((line) => /^[-*]\s+/.test(line))

        // Detect heading-like lead lines: "Status:", "Next:", etc.
        const isLeadIn = /^[A-Z][A-Za-z\s]+:/.test(block) && lines.length === 1

        if (isList) {
          return (
            <ul key={`${block.slice(0, 32)}-${index}`} className="space-y-1.5 pl-5">
              {lines.map((line, itemIndex) => (
                <li key={`${line.slice(0, 32)}-${itemIndex}`} className="list-disc text-foreground">
                  {renderInline(line.replace(/^[-*]\s+/, ""))}
                </li>
              ))}
            </ul>
          )
        }

        if (isLeadIn) {
          const colonIndex = block.indexOf(":")
          const label = block.slice(0, colonIndex)
          const rest = block.slice(colonIndex + 1).trim()
          return (
            <p key={`${block.slice(0, 32)}-${index}`}>
              <span className="font-semibold text-foreground">{label}:</span>
              {rest ? <> {renderInline(rest)}</> : null}
            </p>
          )
        }

        return (
          <p key={`${block.slice(0, 32)}-${index}`}>
            {renderInline(block)}
          </p>
        )
      })}
    </div>
  )
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).filter(Boolean)

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong
          key={`${part.slice(0, 16)}-${index}`}
          className="font-semibold text-foreground"
        >
          {part.slice(2, -2)}
        </strong>
      )
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={`${part.slice(0, 16)}-${index}`}
          className="workspace-inline-code font-mono text-[0.92em]"
        >
          {part.slice(1, -1)}
        </code>
      )
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      const [, label, href] = linkMatch
      const isWeb = /^https?:\/\//.test(href)

      if (isWeb) {
        return (
          <a
            key={`${part.slice(0, 16)}-${index}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline decoration-border underline-offset-4 transition hover:text-foreground/80"
          >
            {label}
          </a>
        )
      }

      return (
        <span
          key={`${part.slice(0, 16)}-${index}`}
          title={href}
          className="workspace-inline-code font-mono text-[0.92em]"
        >
          {label}
        </span>
      )
    }

    return <Fragment key={`${part.slice(0, 16)}-${index}`}>{part}</Fragment>
  })
}
