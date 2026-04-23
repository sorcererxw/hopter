import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react"
import i18n from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"

import type { LocalePreference } from "@/features/config/use-config"

import { messages, type ResolvedLocale } from "./messages"

type LocaleContextValue = {
  locale: LocalePreference
  resolvedLocale: ResolvedLocale
  setLocale: (locale: LocalePreference) => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

const resources = Object.fromEntries(
  Object.entries(messages).map(([locale, translation]) => [
    locale,
    { translation },
  ])
)

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
    lng: "en",
    resources,
    supportedLngs: Object.keys(messages),
  })
}

function getSystemLocale(): ResolvedLocale {
  if (typeof navigator === "undefined") {
    return "en"
  }

  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
  return languages.some((language) => language.toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : "en"
}

function resolveLocale(locale: LocalePreference): ResolvedLocale {
  if (locale === "zh-CN" || locale === "en") {
    return locale
  }

  return getSystemLocale()
}

export function HopterI18nProvider({
  children,
  locale,
  onLocaleChange,
}: {
  children: ReactNode
  locale: LocalePreference
  onLocaleChange: (locale: LocalePreference) => void
}) {
  const resolvedLocale = resolveLocale(locale)

  useEffect(() => {
    void i18n.changeLanguage(resolvedLocale)
    document.documentElement.lang = resolvedLocale
    document.documentElement.dir = "ltr"
  }, [resolvedLocale])

  const value = useMemo(
    () => ({
      locale,
      resolvedLocale,
      setLocale: onLocaleChange,
    }),
    [locale, onLocaleChange, resolvedLocale]
  )

  return (
    <LocaleContext.Provider value={value}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  const value = useContext(LocaleContext)
  if (!value) {
    throw new Error("useLocale must be used within a HopterI18nProvider")
  }
  return value
}
