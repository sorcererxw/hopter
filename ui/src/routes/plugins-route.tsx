import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Search } from "lucide-react"
import { Navigate, useLocation } from "react-router-dom"
import { Chip, Input } from "@heroui/react"

import { workspaceScrollbarClassName } from "@/components/app/shared"
import { WorkspacePageToolbar } from "@/components/app/workspace"
import { useMCPServers } from "@/features/host/use-host-mcp-servers"
import { useHostSkills } from "@/features/host/use-host-skills"
import { cn } from "@/lib/utils"

// PluginsRoute surfaces host-discovered skills and MCP servers in one searchable
// pane. It intentionally excludes project-local skills so this page reads as a
// machine capability inventory.
export function PluginsRoute() {
  const { t } = useTranslation()
  const location = useLocation()
  const { data: skills, isLoading: skillsLoading } = useHostSkills()
  const { data: mcpServers, isLoading: mcpLoading } = useMCPServers()
  const [search, setSearch] = useState("")

  const globalSkills = useMemo(
    () => (skills ?? []).filter((skill) => skill.source !== "project"),
    [skills]
  )

  const filteredSkills = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return globalSkills
    }

    return globalSkills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        (skill.description ?? "").toLowerCase().includes(query)
    )
  }, [globalSkills, search])

  const filteredMCP = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return mcpServers ?? []
    }

    return (mcpServers ?? []).filter((server) =>
      server.name.toLowerCase().includes(query)
    )
  }, [mcpServers, search])

  const totalSkills = globalSkills.length
  const totalMCP = (mcpServers ?? []).length
  const pluginsLoading = skillsLoading || mcpLoading
  const isSearching = search.trim().length > 0
  const hasPluginResults = filteredSkills.length > 0 || filteredMCP.length > 0

  if (location.hash) {
    // Historical settings hashes used to deep-link into this screen. Normalize
    // them so the page owns a single canonical URL.
    return <Navigate to="/plugins" replace />
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      data-testid="plugins-workspace-pane"
    >
      <WorkspacePageToolbar
        title={t("plugins.pageTitle")}
        showOverflowMenu={false}
      />

      <div
        className={cn(
          workspaceScrollbarClassName,
          "min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 lg:px-10"
        )}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex items-baseline gap-2">
              <span className="text-lg text-foreground">{totalSkills}</span>
              <span className="text-sm font-normal text-muted">
                {t("plugins.skillCount", { count: totalSkills })}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-lg text-foreground">{totalMCP}</span>
              <span className="text-sm font-normal text-muted">
                {t("plugins.serverCount", { count: totalMCP })}
              </span>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("plugins.searchPlaceholder")}
              className="h-10 pl-9"
              fullWidth
              variant="secondary"
            />
          </div>

          {pluginsLoading ? (
            <div className="rounded-lg border border-border py-8 text-center text-sm font-normal text-muted">
              {t("plugins.loading")}
            </div>
          ) : !hasPluginResults && isSearching ? (
            <div className="rounded-lg border border-border py-8 text-center text-sm font-normal text-muted">
              {t("plugins.noResults", { query: search })}
            </div>
          ) : (
            <>
              <section id="skills" className="scroll-mt-16">
                <h2 className="mb-3 text-xs tracking-wider text-muted uppercase">
                  {t("plugins.skills")}
                </h2>
                {filteredSkills.length > 0 ? (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {filteredSkills.map((skill) => (
                      <div
                        key={skill.reference || skill.name}
                        className="px-4 py-3"
                      >
                        <div className="text-sm text-foreground">
                          {skill.name}
                        </div>
                        {skill.description ? (
                          <div className="mt-0.5 text-sm font-normal text-muted">
                            {skill.description}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-border py-6 text-center text-sm font-normal text-muted">
                    {t("plugins.noSkills")}
                  </div>
                )}
              </section>

              <section id="mcp" className="scroll-mt-16">
                <h2 className="mb-3 text-xs tracking-wider text-muted uppercase">
                  {t("plugins.mcpServers")}
                </h2>
                {filteredMCP.length > 0 ? (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {filteredMCP.map((server) => (
                      <div
                        key={server.name}
                        className="flex items-center justify-between gap-4 px-4 py-3"
                      >
                        <div className="min-w-0 truncate text-sm text-foreground">
                          {server.name}
                        </div>
                        <Chip
                          size="sm"
                          variant={
                            server.configurationStatus === "configured"
                              ? "soft"
                              : "secondary"
                          }
                        >
                          {server.configurationStatus}
                        </Chip>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-border py-6 text-center text-sm font-normal text-muted">
                    {t("plugins.noMcpServers")}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
