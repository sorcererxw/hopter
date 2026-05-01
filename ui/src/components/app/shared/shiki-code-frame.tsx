import { useEffect, useMemo, useRef, useState } from "react"

import { useTheme } from "@/components/theme-provider"
import {
  highlightCodeToTokens,
  type HighlightLanguage,
} from "@/lib/shiki/highlighter"
import { cn } from "@/lib/utils"

import { CodeContainer } from "./code-container"

type HighlightToken = {
  bgColor?: string
  color?: string
  content: string
  fontStyle?: number
}

type HighlightLine = HighlightToken[]

type ShikiCodeFrameProps = {
  className?: string
  code: string
  filePath?: string
  language?: HighlightLanguage
  showLineNumbers?: boolean
  targetLine?: number
}

const shikiThemeByResolvedTheme = {
  dark: "github-dark-default",
  light: "github-light-default",
} as const

export function ShikiCodeFrame({
  className,
  code,
  filePath,
  language,
  showLineNumbers = true,
  targetLine,
}: ShikiCodeFrameProps) {
  const { resolvedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [lines, setLines] = useState<HighlightLine[] | null>(null)
  const [failed, setFailed] = useState(false)
  const inferredLanguage = useMemo(
    () => language || inferLanguage(filePath),
    [filePath, language]
  )

  useEffect(() => {
    let cancelled = false

    setFailed(false)
    void highlightCodeToTokens(
      code,
      inferredLanguage,
      shikiThemeByResolvedTheme[resolvedTheme]
    )
      .then((result) => {
        if (!cancelled) {
          setLines(result.tokens as HighlightLine[])
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
          setLines(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [code, inferredLanguage, resolvedTheme])

  useEffect(() => {
    if (!targetLine) {
      return
    }
    const container = containerRef.current
    if (!container) {
      return
    }
    const target = container.querySelector<HTMLElement>(
      `[data-line-number="${targetLine}"]`
    )
    target?.scrollIntoView({ block: "center" })
  }, [targetLine, lines, code])

  if (!lines || failed) {
    return (
      <div ref={containerRef} className={cn("min-w-0", className)}>
        <CodeContainer className="py-2">
          {code.split("\n").map((line, index) => {
            const lineNumber = index + 1
            const highlighted = Boolean(targetLine && lineNumber === targetLine)

            return (
              <div
                key={`${lineNumber}-${line}`}
                className={cn(
                  "flex items-start px-0 transition",
                  highlighted ? "bg-amber-300/10" : null
                )}
                data-line-number={lineNumber}
              >
                {showLineNumbers ? (
                  <div
                    className={cn(
                      "w-14 shrink-0 pr-4 text-right font-mono text-sm leading-6 text-muted select-none",
                      highlighted ? "text-amber-100" : null
                    )}
                  >
                    {lineNumber}
                  </div>
                ) : null}
                <pre className="m-0 flex-1 pr-4 font-mono leading-6 whitespace-pre-wrap text-foreground">
                  {line || " "}
                </pre>
              </div>
            )
          })}
        </CodeContainer>
      </div>
    )
  }

  return (
    <div ref={containerRef} className={cn("min-w-0", className)}>
      <CodeContainer className="py-2">
        {lines.map((line, index) => {
          const lineNumber = index + 1
          const highlighted = Boolean(targetLine && lineNumber === targetLine)

          return (
            <div
              key={`${lineNumber}-${line.map((token) => token.content).join("")}`}
              className={cn(
                "flex items-start px-0 transition",
                highlighted ? "bg-amber-300/10" : null
              )}
              data-line-number={lineNumber}
            >
              {showLineNumbers ? (
                <div
                  className={cn(
                    "w-14 shrink-0 pr-4 text-right font-mono text-sm leading-6 text-muted select-none",
                    highlighted ? "text-amber-100" : null
                  )}
                >
                  {lineNumber}
                </div>
              ) : null}
              <pre className="m-0 flex-1 pr-4 font-mono leading-6 whitespace-pre-wrap text-foreground">
                {line.length === 0 ? " " : null}
                {line.map((token, tokenIndex) => (
                  <span
                    key={`${lineNumber}-${tokenIndex}-${token.content}`}
                    style={tokenStyle(token)}
                  >
                    {token.content}
                  </span>
                ))}
              </pre>
            </div>
          )
        })}
      </CodeContainer>
    </div>
  )
}

function tokenStyle(token: HighlightToken) {
  const style: Record<string, string> = {}
  if (token.color) {
    style.color = token.color
  }
  if (token.bgColor) {
    style.backgroundColor = token.bgColor
  }
  if (token.fontStyle) {
    if (token.fontStyle & 1) {
      style.fontStyle = "italic"
    }
    if (token.fontStyle & 2) {
      style.fontWeight = "700"
    }
    if (token.fontStyle & 4) {
      style.textDecoration = "underline"
    }
  }
  return style
}

function inferLanguage(filePath?: string): HighlightLanguage {
  const normalized = filePath?.trim().toLowerCase() || ""
  if (!normalized) {
    return "text"
  }
  if (normalized.endsWith(".diff") || normalized.endsWith(".patch")) {
    return "diff"
  }

  const ext = normalized.split(".").pop() || ""
  switch (ext) {
    case "ts":
      return "ts"
    case "tsx":
      return "tsx"
    case "js":
      return "js"
    case "jsx":
      return "jsx"
    case "mjs":
      return "js"
    case "cjs":
      return "js"
    case "go":
      return "go"
    case "json":
      return "json"
    case "md":
      return "md"
    case "css":
      return "css"
    case "html":
      return "html"
    case "yaml":
    case "yml":
      return "yaml"
    case "toml":
      return "toml"
    case "sh":
      return "bash"
    case "zsh":
      return "bash"
    case "proto":
      return "proto"
    default:
      return "text"
  }
}
