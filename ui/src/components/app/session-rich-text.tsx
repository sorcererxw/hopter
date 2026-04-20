import { isValidElement, useCallback, useEffect, useRef, useState } from "react"
import type {
  AnchorHTMLAttributes,
  ComponentPropsWithoutRef,
  ReactElement,
  ReactNode,
} from "react"
import { Check, Copy } from "lucide-react"

import { CodeContainer } from "@/components/app/code-container"
import { cn } from "@/lib/utils"

type SessionRichTextProps = {
  text: string
  className?: string
  markdown?: boolean
  onLocalPathClick?: (path: string, label: string) => void
}

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
  inline?: boolean
  node?: unknown
}

type MarkdownPreProps = ComponentPropsWithoutRef<"pre"> & {
  node?: unknown
}

type MarkdownModules = {
  ReactMarkdown: typeof import("react-markdown").default
  remarkBreaks: typeof import("remark-breaks").default
  remarkGfm: typeof import("remark-gfm").default
}

let markdownModulesCache: MarkdownModules | null = null
let markdownModulesPromise: Promise<MarkdownModules> | null = null

function loadMarkdownModules() {
  if (markdownModulesCache) {
    return Promise.resolve(markdownModulesCache)
  }

  if (!markdownModulesPromise) {
    markdownModulesPromise = Promise.all([
      import("react-markdown"),
      import("remark-breaks"),
      import("remark-gfm"),
    ]).then(([reactMarkdown, remarkBreaks, remarkGfm]) => {
      markdownModulesCache = {
        ReactMarkdown: reactMarkdown.default,
        remarkBreaks: remarkBreaks.default,
        remarkGfm: remarkGfm.default,
      }
      return markdownModulesCache
    })
  }

  return markdownModulesPromise
}

export function SessionRichText({
  className,
  markdown = true,
  onLocalPathClick,
  text,
}: SessionRichTextProps) {
  const [markdownModules, setMarkdownModules] =
    useState<MarkdownModules | null>(() => markdownModulesCache)
  const paragraphCount = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean).length
  const isLongForm = paragraphCount > 3

  useEffect(() => {
    if (!markdown) {
      return
    }

    if (markdownModules) {
      return
    }

    let cancelled = false

    void loadMarkdownModules().then((modules) => {
      if (!cancelled) {
        setMarkdownModules(modules)
      }
    })

    return () => {
      cancelled = true
    }
  }, [markdown, markdownModules])

  if (!markdown || !markdownModules) {
    return (
      <PlainRichText
        className={className}
        isLongForm={isLongForm}
        text={text}
      />
    )
  }

  const { ReactMarkdown, remarkBreaks, remarkGfm } = markdownModules

  return (
    <div
      className={cn(
        "min-w-0 text-base leading-6 font-medium break-words text-foreground",
        isLongForm ? "space-y-3" : "space-y-2",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ children, href, ...props }) => (
            <MarkdownLink
              href={href}
              onLocalPathClick={onLocalPathClick}
              {...props}
            >
              {children}
            </MarkdownLink>
          ),
          code: ({
            children,
            className: _codeClassName,
          }: MarkdownCodeProps) => {
            const code = flattenMarkdownChildren(children)

            return (
              <code className="workspace-inline-code font-mono text-sm">
                {code}
              </code>
            )
          },
          pre: ({ children }: MarkdownPreProps) => {
            const codeChild = getCodeElement(children)
            const code = trimTrailingNewline(
              flattenMarkdownChildren(codeChild?.props.children ?? children)
            )
            const language =
              codeChild?.props.className?.match(/language-([\w-]+)/)?.[1]

            return <CodeBlock code={code} language={language} />
          },
          li: ({ children }) => (
            <li className="list-disc text-foreground">{children}</li>
          ),
          ol: ({ children }) => (
            <ol className="space-y-1.5 pl-5">{children}</ol>
          ),
          p: ({ children }) => <p>{children}</p>,
          table: ({ children }) => (
            <div className="workspace-scrollbar my-3 max-w-full overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 border border-border text-left text-sm">
                {children}
              </table>
            </div>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          td: ({ children }) => (
            <td className="border-r border-b border-border px-3 py-2 align-top text-foreground last:border-r-0">
              {children}
            </td>
          ),
          th: ({ children }) => (
            <th className="border-r border-b border-border bg-muted px-3 py-2 text-left font-semibold text-foreground last:border-r-0">
              {children}
            </th>
          ),
          thead: ({ children }) => <thead>{children}</thead>,
          tr: ({ children }) => (
            <tr className="bg-background even:bg-muted/20 [&:last-child>td]:border-b-0 [&:last-child>th]:border-b-0">
              {children}
            </tr>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">
              {children}
            </strong>
          ),
          ul: ({ children }) => (
            <ul className="space-y-1.5 pl-5">{children}</ul>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function PlainRichText({
  className,
  isLongForm,
  text,
}: {
  className?: string
  isLongForm: boolean
  text: string
}) {
  return (
    <div
      className={cn(
        "min-w-0 text-base leading-6 font-medium break-words text-foreground",
        isLongForm ? "space-y-3" : "space-y-2",
        className
      )}
    >
      <div className="whitespace-pre-wrap">{text}</div>
    </div>
  )
}

function MarkdownLink({
  children,
  href,
  onLocalPathClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode
  href?: string
  onLocalPathClick?: (path: string, label: string) => void
}) {
  const label = flattenMarkdownChildren(children)

  if (!href) {
    return <span>{children}</span>
  }

  if (/^https?:\/\//.test(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-foreground underline decoration-border underline-offset-4 transition hover:text-foreground/80"
        {...props}
      >
        {children}
      </a>
    )
  }

  return (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        if (!onLocalPathClick) {
          return
        }
        event.preventDefault()
        onLocalPathClick(href, label)
      }}
      className="font-mono text-foreground underline decoration-border underline-offset-4 transition hover:text-foreground/80"
      {...props}
    >
      {children}
    </a>
  )
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const displayCode = formatCodeForDisplay(code, language)

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
      <CodeContainer as="pre" className="pt-4 pb-3">
        <code data-language={language || undefined}>{displayCode}</code>
      </CodeContainer>
    </div>
  )
}

function flattenMarkdownChildren(children: ReactNode): string {
  return Array.isArray(children)
    ? children.map((child) => flattenMarkdownChildren(child)).join("")
    : typeof children === "string" || typeof children === "number"
      ? String(children)
      : children && typeof children === "object" && "props" in children
        ? flattenMarkdownChildren(
            (children as { props?: { children?: ReactNode } }).props
              ?.children ?? ""
          )
        : ""
}

function getCodeElement(children: ReactNode) {
  if (isValidElement(children) && children.type === "code") {
    return children as ReactElement<{
      children?: ReactNode
      className?: string
    }>
  }

  if (Array.isArray(children)) {
    const element = children.find(
      (child) => isValidElement(child) && child.type === "code"
    )
    if (element && isValidElement(element)) {
      return element as ReactElement<{
        children?: ReactNode
        className?: string
      }>
    }
  }

  return null
}

function trimTrailingNewline(value: string) {
  return value.replace(/\n$/, "")
}

function formatCodeForDisplay(code: string, language?: string) {
  if (language || !looksLikeMarkup(code)) {
    return code
  }

  return prettyPrintMarkup(code)
}

function looksLikeMarkup(code: string) {
  const trimmed = code.trim()
  return (
    trimmed.startsWith("<") &&
    trimmed.includes(">") &&
    /<\/?[a-zA-Z]/.test(trimmed)
  )
}

function prettyPrintMarkup(code: string) {
  const chunks = code.replace(/>\s*</g, ">\n<").split("\n")
  let depth = 0

  return chunks
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      if (/^<\//.test(chunk)) {
        depth = Math.max(depth - 1, 0)
      }

      const line = `${"  ".repeat(depth)}${chunk}`

      if (
        /^<[^!?/][^>]*[^/]?>$/.test(chunk) &&
        !/^<[^>]+>.*<\/[^>]+>$/.test(chunk)
      ) {
        depth += 1
      }

      return line
    })
    .join("\n")
}
