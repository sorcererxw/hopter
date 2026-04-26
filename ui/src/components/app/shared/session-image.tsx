import { useState } from "react"
import type { ImgHTMLAttributes, ReactNode } from "react"

import { resolveImageSource } from "@/lib/utils"

export function SessionImage({
  src,
  alt,
  fallback,
  onError: onErrorProp,
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string
  fallback?: ReactNode
  onError?: ImgHTMLAttributes<HTMLImageElement>["onError"]
}) {
  const { isUsable, src: normalizedSrc } = resolveImageSource(src)
  const [hasError, setHasError] = useState(false)

  if (!isUsable || hasError || !normalizedSrc) {
    return fallback ?? null
  }

  return (
    <img
      src={normalizedSrc}
      alt={alt}
      onError={(event) => {
        setHasError(true)
        onErrorProp?.(event)
      }}
      {...props}
    />
  )
}
