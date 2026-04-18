import { createHighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"
import type { BundledLanguage, HighlighterCore } from "shiki"

export type HighlightLanguage = BundledLanguage | "text"

const themeLoaders = [
  () => import("@shikijs/themes/github-dark-default"),
  () => import("@shikijs/themes/github-light-default"),
]

const languageLoaders: Partial<
  Record<BundledLanguage, () => Promise<unknown>>
> = {
  bash: () => import("@shikijs/langs/bash"),
  css: () => import("@shikijs/langs/css"),
  diff: () => import("@shikijs/langs/diff"),
  go: () => import("@shikijs/langs/go"),
  html: () => import("@shikijs/langs/html"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsx: () => import("@shikijs/langs/jsx"),
  markdown: () => import("@shikijs/langs/markdown"),
  proto: () => import("@shikijs/langs/proto"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  yaml: () => import("@shikijs/langs/yaml"),
}

const loadedLanguages = new Set<string>()
let highlighterPromise: Promise<HighlighterCore> | null = null

async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: themeLoaders.map((loader) => loader()),
      langs: [],
    })
  }

  return highlighterPromise
}

export async function ensureShikiLanguage(language: HighlightLanguage) {
  if (language === "text") {
    return
  }
  if (loadedLanguages.has(language)) {
    return
  }

  const loader = languageLoaders[language]
  if (!loader) {
    return
  }

  const highlighter = await getHighlighter()
  await highlighter.loadLanguage(loader() as never)
  loadedLanguages.add(language)
}

export async function highlightCodeToTokens(
  code: string,
  language: HighlightLanguage,
  theme: "github-dark-default" | "github-light-default"
) {
  const highlighter = await getHighlighter()
  await ensureShikiLanguage(language)

  return highlighter.codeToTokens(code, {
    lang: language === "text" ? "text" : language,
    theme,
  })
}
