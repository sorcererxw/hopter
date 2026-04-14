import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toUserFacingError(action: string, detail: unknown) {
  if (detail instanceof Error) {
    console.error(detail);
  } else {
    console.error(action, detail);
  }

  return `${action}. Refresh and try again.`;
}
