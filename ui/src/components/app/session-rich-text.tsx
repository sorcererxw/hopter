import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"

import { cn } from "@/lib/utils"

type SessionRichTextProps = {
  text: string
  className?: string
}

type RichTextBlock =
  | {
      type: "text"
      text: string
    }
  | {
      type: "code"
      code: string
      language?: string
    }

export function SessionRichText({ className, text }: SessionRichTextProps) {
  const blocks = parseRichTextBlocks(text)

  const isLongForm = blocks.length > 3

  return (
    <div
      className={cn(
        "min-w-0 text-base leading-7 font-medium break-words text-foreground",
        isLongForm ? "space-y-4" : "space-y-2.5",
        className
      )}
    >
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <CodeBlock
              key={`${block.language || "plain"}-${index}`}
              code={block.code}
              language={block.language}
            />
          )
        }

        const lines = block.text.split("\n").map((line) => line.trimEnd())
        const isList = lines.every((line) => /^[-*]\s+/.test(line))
        const leadInListLines =
          lines.length > 1 && /[:：]\s*$/.test(lines[0]) ? lines.slice(1) : []
        const hasLeadInList =
          leadInListLines.length > 0 &&
          leadInListLines.every((line) => /^[-*]\s+/.test(line))

        // Detect heading-like lead lines: "Status:", "Next:", etc.
        const isLeadIn = /.+[:：]\s*.+/.test(block.text) && lines.length === 1

        if (isList) {
          return (
            <ul
              key={`${block.text.slice(0, 32)}-${index}`}
              className="space-y-1.5 pl-5"
            >
              {lines.map((line, itemIndex) => (
                <li
                  key={`${line.slice(0, 32)}-${itemIndex}`}
                  className="list-disc text-foreground"
                >
                  {renderInline(line.replace(/^[-*]\s+/, ""))}
                </li>
              ))}
            </ul>
          )
        }

        if (hasLeadInList) {
          return (
            <Fragment key={`${block.text.slice(0, 32)}-${index}`}>
              <p>{renderLeadIn(lines[0])}</p>
              <ul className="space-y-1.5 pl-5">
                {leadInListLines.map((line, itemIndex) => (
                  <li
                    key={`${line.slice(0, 32)}-${itemIndex}`}
                    className="list-disc text-foreground"
                  >
                    {renderInline(line.replace(/^[-*]\s+/, ""))}
                  </li>
                ))}
              </ul>
            </Fragment>
          )
        }

        if (isLeadIn) {
          return (
            <p key={`${block.text.slice(0, 32)}-${index}`}>
              {renderLeadIn(block.text)}
            </p>
          )
        }

        return (
          <p key={`${block.text.slice(0, 32)}-${index}`}>
            {renderInline(block.text)}
          </p>
        )
      })}
    </div>
  )
}

function renderLeadIn(text: string) {
  const separatorIndex = Math.max(text.indexOf(":"), text.indexOf("："))
  if (separatorIndex < 0) {
    return renderInline(text)
  }

  const label = text.slice(0, separatorIndex)
  const separator = text.slice(separatorIndex, separatorIndex + 1)
  const rest = text.slice(separatorIndex + 1).trim()

  return (
    <>
      <span className="font-semibold text-foreground">
        {label}
        {separator}
      </span>
      {rest ? <> {renderInline(rest)}</> : null}
    </>
  )
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current)
      }
    }
  }, [])

  const handleCopy = useCallback(() => {
    if (!navigator.clipboard) {
      return
    }

    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true)
        if (copiedTimerRef.current) {
          clearTimeout(copiedTimerRef.current)
        }
        copiedTimerRef.current = setTimeout(() => setCopied(false), 1500)
      },
      () => {
        // Clipboard write failed; silently ignore.
      }
    )
  }, [code])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
        aria-label={copied ? "Copied code" : "Copy code"}
        data-testid="session-code-copy"
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      <pre className="workspace-scrollbar max-w-full overflow-x-auto rounded-lg border border-border bg-card px-4 pt-10 pb-3 font-mono text-sm leading-6 text-foreground">
        <code data-language={language || undefined}>{code}</code>
      </pre>
    </div>
  )
}

function parseRichTextBlocks(text: string): RichTextBlock[] {
  const normalized = text.replace(/\r\n?/g, "\n")
  const lines = normalized.split("\n")
  const blocks: RichTextBlock[] = []
  let textLines: string[] = []
  let codeLines: string[] = []
  let codeLanguage = ""
  let inCodeBlock = false

  const flushText = () => {
    const value = textLines.join("\n")
    textLines = []

    value
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .forEach((block) => {
        blocks.push({ text: block, type: "text" })
      })
  }

  const flushCode = () => {
    blocks.push({
      code: codeLines.join("\n").replace(/\n+$/, ""),
      language: codeLanguage || undefined,
      type: "code",
    })
    codeLines = []
    codeLanguage = ""
  }

  lines.forEach((line) => {
    if (!inCodeBlock) {
      const codeFence = line.match(/^```([^`]*)$/)
      if (codeFence) {
        flushText()
        inCodeBlock = true
        codeLanguage = codeFence[1].trim()
        return
      }

      textLines.push(line)
      return
    }

    if (line === "```") {
      flushCode()
      inCodeBlock = false
      return
    }

    codeLines.push(line)
  })

  if (inCodeBlock) {
    flushCode()
  } else {
    flushText()
  }

  return blocks
}

function renderInline(text: string) {
  const parts = text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g)
    .filter(Boolean)

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
