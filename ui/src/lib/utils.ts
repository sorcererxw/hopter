import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isLikelyFilesystemPath(value: string) {
  const normalized = value.trim()
  if (!normalized) {
    return false
  }

  if (normalized.startsWith("file://")) {
    return true
  }

  return (
    normalized.startsWith("/Users/") ||
    normalized.startsWith("/tmp/") ||
    normalized.startsWith("/var/") ||
    normalized.startsWith("/home/") ||
    /^[A-Za-z]:[\\/]/.test(normalized)
  )
}

export function resolveImageSource(rawValue?: string | null) {
  if (!rawValue) {
    return {
      isUsable: false,
      src: "",
    }
  }

  const src = rawValue.trim()
  if (!src) {
    return {
      isUsable: false,
      src: "",
    }
  }

  if (src.startsWith("/api/image-proxy")) {
    return {
      isUsable: true,
      src,
    }
  }

  if (src.startsWith("data:image/")) {
    return {
      isUsable: true,
      src,
    }
  }

  if (src.startsWith("file://")) {
    const filesystemPath = src.replace(/^file:\/\//, "")
    return {
      isUsable: isLikelyFilesystemPath(filesystemPath),
      src: isLikelyFilesystemPath(filesystemPath)
        ? `/api/image-proxy?path=${encodeURIComponent(filesystemPath)}`
        : "",
    }
  }

  if (isLikelyFilesystemPath(src)) {
    return {
      isUsable: true,
      src: `/api/image-proxy?path=${encodeURIComponent(src)}`,
    }
  }

  if (/^https?:\/\//i.test(src)) {
    return {
      isUsable: true,
      src: `/api/image-proxy?url=${encodeURIComponent(src)}`,
    }
  }

  return {
    isUsable: false,
    src,
  }
}

export function resolveLocalFileProxyHref(rawValue?: string | null) {
  if (!rawValue) {
    return ""
  }

  const src = rawValue.trim()
  if (!src || src.startsWith("/api/file-proxy")) {
    return src
  }

  if (src.startsWith("file://")) {
    const filesystemPath = filePathFromFileUrl(src)
    return isLikelyFilesystemPath(filesystemPath)
      ? `/api/file-proxy?path=${encodeURIComponent(filesystemPath)}`
      : ""
  }

  if (isLikelyFilesystemPath(src)) {
    return `/api/file-proxy?path=${encodeURIComponent(src)}`
  }

  return ""
}

function filePathFromFileUrl(value: string) {
  try {
    return decodeURI(new URL(value).pathname)
  } catch {
    return value.replace(/^file:\/\//, "")
  }
}
