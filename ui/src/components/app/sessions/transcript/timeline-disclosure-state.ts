import { useCallback, useEffect, useState } from "react"

const MAX_DISCLOSURE_STATES = 500

const disclosureState = new Map<string, boolean>()

function rememberDisclosureState(key: string | undefined, expanded: boolean) {
  if (!key) {
    return
  }

  disclosureState.set(key, expanded)
  if (disclosureState.size <= MAX_DISCLOSURE_STATES) {
    return
  }

  const firstKey = disclosureState.keys().next().value
  if (firstKey) {
    disclosureState.delete(firstKey)
  }
}

function readDisclosureState(
  key: string | undefined,
  defaultExpanded: boolean
) {
  return key ? (disclosureState.get(key) ?? defaultExpanded) : defaultExpanded
}

// useTranscriptDisclosure preserves manually toggled transcript disclosure state across polling refreshes.
export function useTranscriptDisclosure(
  defaultExpanded = false,
  disclosureKey?: string
) {
  const [expanded, setExpanded] = useState(() =>
    readDisclosureState(disclosureKey, defaultExpanded)
  )

  useEffect(() => {
    setExpanded(readDisclosureState(disclosureKey, defaultExpanded))
  }, [defaultExpanded, disclosureKey])

  const toggleExpanded = useCallback(() => {
    setExpanded((previous) => {
      const next = !previous
      rememberDisclosureState(disclosureKey, next)
      return next
    })
  }, [disclosureKey])

  return [expanded, toggleExpanded] as const
}

// useActivitySyncedDisclosure opens live activity rows without collapsing them when the activity completes.
export function useActivitySyncedDisclosure(
  active: boolean,
  disclosureKey?: string
) {
  const [expanded, setExpanded] = useState(() =>
    readDisclosureState(disclosureKey, active)
  )

  useEffect(() => {
    if (active) {
      rememberDisclosureState(disclosureKey, true)
      setExpanded(true)
      return
    }

    setExpanded(readDisclosureState(disclosureKey, false))
  }, [active, disclosureKey])

  const toggleExpanded = useCallback(() => {
    setExpanded((previous) => {
      const next = !previous
      rememberDisclosureState(disclosureKey, next)
      return next
    })
  }, [disclosureKey])

  return [expanded, toggleExpanded] as const
}
