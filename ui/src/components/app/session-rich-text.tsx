import { Fragment } from "react"

type SessionRichTextProps = {
  text: string
  className?: string
}

export function SessionRichText({ className, text }: SessionRichTextProps) {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trimEnd())
        const isList = lines.every((line) => /^[-*]\s+/.test(line))

        if (isList) {
          return (
            <ul key={`${block}-${index}`} className="space-y-2 pl-5">
              {lines.map((line, itemIndex) => (
                <li key={`${line}-${itemIndex}`} className="list-disc">
                  {renderInline(line.replace(/^[-*]\s+/, ""))}
                </li>
              ))}
            </ul>
          )
        }

        return <p key={`${block}-${index}`}>{renderInline(block)}</p>
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
          key={`${part}-${index}`}
          className="font-semibold text-foreground"
        >
          {part.slice(2, -2)}
        </strong>
      )
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={`${part}-${index}`} className="workspace-inline-code font-mono text-[0.92em]">
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
            key={`${part}-${index}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline decoration-white/20 underline-offset-4 transition hover:text-white"
          >
            {label}
          </a>
        )
      }

      return (
        <span key={`${part}-${index}`} title={href} className="workspace-inline-code font-mono text-[0.92em]">
          {label}
        </span>
      )
    }

    return <Fragment key={`${part}-${index}`}>{part}</Fragment>
  })
}
