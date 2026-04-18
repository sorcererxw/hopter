import type { ReactNode } from "react"

import { CardTitle } from "@/components/ui/card"

type SettingsPageLayoutProps = {
  children: ReactNode
  title: string
}

export function SettingsPageLayout({
  children,
  title,
}: SettingsPageLayoutProps) {
  return (
    <div>
      <CardTitle className="mb-8 hidden text-2xl text-foreground md:block">
        {title}
      </CardTitle>
      {children}
    </div>
  )
}
