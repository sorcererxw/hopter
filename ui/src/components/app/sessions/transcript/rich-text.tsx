import { isValidElement, useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type {
  AnchorHTMLAttributes,
  ComponentPropsWithoutRef,
  ReactElement,
  ReactNode,
} from "react"
import { Copy, Tick02 } from "@/components/icons/hugeicons"

import {
  inlineCodeClassName,
  ShikiCodeFrame,
  SkillReferenceChip,
  SessionImage,
  workspaceScrollbarClassName,
} from "@/components/app/shared"
import { useMCPServers } from "@/features/host/use-host-mcp-servers"
import { useHostSkill } from "@/features/host/use-host-skill"
import type { HighlightLanguage } from "@/lib/shiki/highlighter"
import { cn, resolveLocalFileProxyHref } from "@/lib/utils"

type SessionRichTextProps = {
  text: string
  className?: string
  markdown?: boolean
  onLocalPathClick?: (path: string, label: string) => void
}

type InlineReferenceMetadata = {
  description?: string
  name?: string
  reference: string
  source?: string
  variant: "plugin" | "skill"
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

// SessionRichText renders assistant output, reviews, and summaries with a lazy
// markdown path plus a plain-text fallback. It upgrades explicit markdown
// references into richer chips while keeping plain transcript text untouched.
export function SessionRichText({
  className,
  markdown = true,
  onLocalPathClick,
  text,
}: SessionRichTextProps) {
  const { t } = useTranslation()
  const mcpServersQuery = useMCPServers()
  const pluginByReference = new Map(
    (mcpServersQuery.data ?? []).map((server) => [
      normalizeReference(server.name),
      {
        name: server.name,
        reference: server.name,
        source: server.source,
        variant: "plugin" as const,
      },
    ])
  )
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
        pluginByReference={pluginByReference}
        text={text}
      />
    )
  }

  const { ReactMarkdown, remarkBreaks, remarkGfm } = markdownModules

  return (
    <div
      className={cn(
        "min-w-0 leading-6 break-words whitespace-normal text-foreground",
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
              pluginByReference={pluginByReference}
              {...props}
            >
              {children}
            </MarkdownLink>
          ),
          code: ({ children, className: codeClassName }: MarkdownCodeProps) => {
            const code = flattenMarkdownChildren(children)

            if (codeClassName?.includes("language-")) {
              // Leave fenced code blocks for the surrounding <pre> renderer.
              return <code className={codeClassName}>{code}</code>
            }

            return (
              <code className={cn(inlineCodeClassName, "font-mono text-sm")}>
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
          img: ({ src, alt, ...props }) => (
            <SessionImage
              src={src}
              alt={alt}
              fallback={
                <span
                  className="inline-flex items-center rounded-md border border-border bg-surface-secondary px-1 py-0.5 text-sm text-muted"
                  {...props}
                >
                  {typeof alt === "string" && alt.trim().length > 0
                    ? alt
                    : t("transcript.image")}
                </span>
              }
              className="inline-block max-w-full rounded-lg border border-border"
              {...props}
            />
          ),
          li: ({ children }) => (
            <li className="list-disc text-foreground">{children}</li>
          ),
          ol: ({ children }) => (
            <ol className="space-y-1.5 pl-5">{children}</ol>
          ),
          p: ({ children }) => <p>{children}</p>,
          table: ({ children }) => (
            <div
              className={cn(
                workspaceScrollbarClassName,
                "my-3 max-w-full overflow-x-auto"
              )}
            >
              <table className="min-w-full border-separate border-spacing-0 rounded-lg border border-border bg-surface text-left text-sm">
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
            <th className="border-r border-b border-border bg-surface-secondary px-3 py-2 text-left font-bold text-foreground last:border-r-0">
              {children}
            </th>
          ),
          thead: ({ children }) => <thead>{children}</thead>,
          tr: ({ children }) => (
            <tr className="bg-surface even:bg-surface-secondary/60 [&:last-child>td]:border-b-0 [&:last-child>th]:border-b-0">
              {children}
            </tr>
          ),
          strong: ({ children }) => (
            <strong className="font-bold text-foreground">{children}</strong>
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
  pluginByReference,
  text,
}: {
  className?: string
  isLongForm: boolean
  pluginByReference: Map<string, InlineReferenceMetadata>
  text: string
}) {
  // Plain fallback recognizes explicit markdown reference links while markdown
  // modules load, but it does not upgrade free-form $skill text.
  return (
    <div
      className={cn(
        "min-w-0 leading-6 break-words whitespace-normal text-foreground",
        isLongForm ? "space-y-3" : "space-y-2",
        className
      )}
    >
      <div className="break-words whitespace-pre-wrap">
        {renderInlineHighlightedPlainText(text, pluginByReference)}
      </div>
    </div>
  )
}

function renderInlineHighlightedPlainText(
  text: string,
  pluginByReference: Map<string, InlineReferenceMetadata>
) {
  const skillParts = renderSkillMarkdownTokens(text)
  const pluginParts = skillParts.flatMap((part) =>
    typeof part === "string"
      ? renderPluginMarkdownTokens(part, pluginByReference)
      : [part]
  )
  return pluginParts.flatMap((part, index) =>
    typeof part === "string"
      ? renderReferenceTokens(part, pluginByReference, index)
      : [part]
  )
}

function renderSkillMarkdownTokens(text: string) {
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/gi
  const parts: ReactNode[] = []
  let lastIndex = 0

  for (const match of text.matchAll(pattern)) {
    const token = match[0] ?? ""
    const label = match[1]?.trim() ?? ""
    const href = match[2]?.trim() ?? ""
    const matchIndex = match.index ?? 0
    const reference = skillReferenceFromLabel(label)
    const path = skillPathFromHref(href)

    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex))
    }

    if (!reference || !path) {
      parts.push(token)
    } else {
      parts.push(
        <SkillLinkChip
          key={`skill-md-${matchIndex}`}
          labelReference={reference}
          path={path}
        />
      )
    }
    lastIndex = matchIndex + token.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

function renderPluginMarkdownTokens(
  text: string,
  pluginByReference: Map<string, InlineReferenceMetadata>
) {
  const pattern = /\[([^\]]+)\]\((plugin:\/\/[^)]+)\)/gi
  const parts: ReactNode[] = []
  let lastIndex = 0

  for (const match of text.matchAll(pattern)) {
    const token = match[0] ?? ""
    const label = match[1]?.replace(/^@/, "").trim() ?? ""
    const href = match[2] ?? ""
    const matchIndex = match.index ?? 0
    const reference = pluginReferenceFromHref(href, label)

    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex))
    }

    if (!reference) {
      parts.push(token)
    } else {
      const metadata = pluginByReference.get(normalizeReference(reference))
      parts.push(
        <SkillReferenceChip
          key={`plugin-md-${matchIndex}`}
          data-testid="session-plugin-reference"
          description={metadata?.description}
          name={metadata?.name}
          reference={label || metadata?.name || reference}
          source={metadata?.source}
          tooltipPlacement="bottom"
          variant="plugin"
        />
      )
    }
    lastIndex = matchIndex + token.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

function renderReferenceTokens(
  text: string,
  pluginByReference: Map<string, InlineReferenceMetadata>,
  keyPrefix: number
) {
  const pattern = /(^|[\s([{])(@[a-z0-9:-]+)/gi
  const parts: ReactNode[] = []
  let lastIndex = 0

  for (const match of text.matchAll(pattern)) {
    const fullMatch = match[0] ?? ""
    const prefix = match[1] ?? ""
    const token = match[2] ?? ""
    const matchIndex = match.index ?? 0
    const reference = token.slice(1)
    const label = reference
    const metadata = pluginByReference.get(normalizeReference(reference))
    const tokenStart = matchIndex + prefix.length

    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex))
    }
    if (prefix) {
      parts.push(prefix)
    }
    if (token) {
      if (!metadata) {
        parts.push(token)
      } else {
        parts.push(
          <SkillReferenceChip
            key={`${keyPrefix}-${token}-${tokenStart}`}
            data-testid="session-plugin-reference"
            description={metadata?.description}
            name={metadata?.name}
            reference={metadata?.name || label}
            source={metadata?.source}
            tooltipPlacement="bottom"
            variant="plugin"
          />
        )
      }
    }

    lastIndex = matchIndex + fullMatch.length
    if (lastIndex < tokenStart + token.length) {
      lastIndex = tokenStart + token.length
    }
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : text
}

function MarkdownLink({
  children,
  href,
  onLocalPathClick,
  pluginByReference,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode
  href?: string
  onLocalPathClick?: (path: string, label: string) => void
  pluginByReference: Map<string, InlineReferenceMetadata>
}) {
  const label = flattenMarkdownChildren(children)

  if (!href) {
    return <span>{children}</span>
  }

  const skillReference = skillReferenceFromLabel(label)
  const skillPath = skillPathFromHref(href)
  if (skillReference && skillPath) {
    return <SkillLinkChip labelReference={skillReference} path={skillPath} />
  }

  const pluginReference = pluginReferenceFromHref(href, label)
  if (pluginReference) {
    const plugin = pluginByReference.get(normalizeReference(pluginReference))
    const displayLabel = label.replace(/^@/, "").trim()
    return (
      <SkillReferenceChip
        data-testid="session-plugin-reference"
        description={plugin?.description}
        name={plugin?.name}
        reference={displayLabel || plugin?.name || pluginReference}
        source={plugin?.source}
        tooltipPlacement="bottom"
        variant="plugin"
      />
    )
  }

  if (/^https?:\/\//.test(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-foreground underline decoration-border underline-offset-4 transition hover:text-muted"
        {...props}
      >
        {children}
      </a>
    )
  }

  const fileProxyHref = resolveLocalFileProxyHref(localPathFromHref(href))
  if (fileProxyHref) {
    return (
      <a
        href={fileProxyHref}
        target="_blank"
        rel="noreferrer"
        title={localPathFromHref(href)}
        className="text-foreground underline decoration-border underline-offset-4 transition hover:text-muted"
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
        // Local file links are preview intents inside the workspace, not full
        // browser navigations away from the current session.
        event.preventDefault()
        onLocalPathClick(href, label)
      }}
      className="font-mono text-foreground underline decoration-border underline-offset-4 transition hover:text-muted"
      {...props}
    >
      {children}
    </a>
  )
}

function SkillLinkChip({
  labelReference,
  path,
}: {
  labelReference: string
  path: string
}) {
  const skillQuery = useHostSkill(path)
  const skill = skillQuery.data

  return (
    <SkillReferenceChip
      data-testid="session-skill-reference"
      description={skill?.description}
      name={skill?.name}
      reference={skill?.reference || labelReference}
      source={skill?.source}
      tooltipPlacement="bottom"
      variant="skill"
    />
  )
}

function skillReferenceFromLabel(label: string) {
  const normalized = label.trim()
  if (!/^\$[a-z0-9:-]+$/i.test(normalized)) {
    return ""
  }
  return normalized.slice(1)
}

function skillPathFromHref(href: string) {
  const path = localPathFromHref(href)
  const pathWithoutAnchor = path.replace(/[?#].*$/, "")
  if (!/(^|\/)SKILL\.md$/i.test(pathWithoutAnchor)) {
    return ""
  }
  return pathWithoutAnchor
}

function localPathFromHref(href: string) {
  const trimmed = href.trim()
  if (trimmed.startsWith("file://")) {
    try {
      return decodeURI(new URL(trimmed).pathname)
    } catch {
      return trimmed
    }
  }
  try {
    return decodeURI(trimmed)
  } catch {
    return trimmed
  }
}

function pluginReferenceFromHref(href: string, label: string) {
  if (!href.startsWith("plugin://")) {
    return ""
  }
  const withoutScheme = href.slice("plugin://".length)
  const reference = withoutScheme.split("@")[0]?.trim()
  if (reference) {
    return reference
  }
  return label.replace(/^@/, "").trim()
}

function normalizeReference(value: string) {
  return value.trim().toLowerCase()
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const displayCode = formatCodeForDisplay(code, language)
  const highlightLanguage = normalizeMarkdownCodeLanguage(language, displayCode)
  const languageLabel = formatCodeLanguageLabel(language, highlightLanguage)

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
    <div className="my-3 min-w-0 overflow-hidden rounded-lg border border-border bg-transparent shadow-none">
      <div className="flex min-h-9 items-center justify-between gap-3 border-b border-border px-3 py-1.5">
        <div className="font-mono text-sm text-muted">
          {languageLabel || "text"}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-md bg-surface-tertiary/0 px-2 py-1 text-sm text-muted transition hover:bg-surface-tertiary hover:text-foreground"
          aria-label={
            copied ? t("transcript.copied") : t("transcript.copyCode")
          }
          data-testid="session-code-copy"
        >
          {copied ? (
            <Tick02 className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          <span>{copied ? t("transcript.copied") : t("transcript.copy")}</span>
        </button>
      </div>
      <ShikiCodeFrame
        code={displayCode}
        className="[&_pre]:bg-transparent [&>div]:rounded-none [&>div]:border-0 [&>div]:bg-transparent [&>div]:shadow-none"
        language={highlightLanguage}
        showLineNumbers={false}
      />
    </div>
  )
}

function formatCodeLanguageLabel(
  rawLanguage: string | undefined,
  highlightLanguage: HighlightLanguage
) {
  const label = (rawLanguage || "").trim() || highlightLanguage
  return label === "text" ? "" : label
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

function normalizeMarkdownCodeLanguage(
  language: string | undefined,
  code: string
): HighlightLanguage {
  const normalized = (language || "").trim().toLowerCase()

  switch (normalized) {
    case "ts":
      return "typescript"
    case "tsx":
      return "tsx"
    case "js":
    case "mjs":
    case "cjs":
      return "javascript"
    case "jsx":
      return "jsx"
    case "go":
      return "go"
    case "json":
      return "json"
    case "md":
    case "markdown":
      return "markdown"
    case "css":
      return "css"
    case "html":
      return "html"
    case "yaml":
    case "yml":
      return "yaml"
    case "toml":
      return "toml"
    case "bash":
    case "sh":
    case "zsh":
    case "shell":
      return "bash"
    case "diff":
    case "patch":
      return "diff"
    case "proto":
    case "protobuf":
      return "proto"
    case "":
      return inferPlainCodeLanguage(code)
    default:
      return "text"
  }
}

function inferPlainCodeLanguage(code: string): HighlightLanguage {
  if (looksLikeMarkup(code)) {
    return "html"
  }

  return "text"
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
