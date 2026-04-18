import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { useLocation } from "react-router-dom"

import { Input } from "@/components/ui/input"
import { useHostSkills } from "@/features/host/use-host-skills"
import { useMCPServers } from "@/features/host/use-host-mcp-servers"
import { SettingsPageLayout } from "@/routes/settings/settings-page-layout"

export function SettingsPluginsPage() {
  const location = useLocation()
  const { data: skills, isLoading: skillsLoading } = useHostSkills()
  const { data: mcpServers, isLoading: mcpLoading } = useMCPServers()
  const [search, setSearch] = useState("")

  const globalSkills = useMemo(
    () => (skills ?? []).filter((s) => s.source !== "project"),
    [skills]
  )

  const filteredSkills = useMemo(() => {
    if (!search.trim()) return globalSkills
    const q = search.toLowerCase()
    return globalSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    )
  }, [globalSkills, search])

  const filteredMCP = useMemo(() => {
    if (!search.trim()) return mcpServers ?? []
    const q = search.toLowerCase()
    return (mcpServers ?? []).filter((s) => s.name.toLowerCase().includes(q))
  }, [mcpServers, search])

  const totalSkills = globalSkills.length
  const totalMCP = (mcpServers ?? []).length
  const isLoading = skillsLoading || mcpLoading
  const hasResults = filteredSkills.length > 0 || filteredMCP.length > 0
  const isSearching = search.trim().length > 0

  useEffect(() => {
    if (!location.hash || isLoading) {
      return
    }

    const sectionId = location.hash.slice(1)
    const frame = requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ block: "start" })
    })

    return () => cancelAnimationFrame(frame)
  }, [filteredMCP.length, filteredSkills.length, isLoading, location.hash])

  return (
    <SettingsPageLayout title="Plugins">
      {/* Overview counts */}
      <div className="mb-6 flex gap-6">
        <div className="flex items-baseline gap-2">
          <span className="text-lg text-foreground">{totalSkills}</span>
          <span className="text-sm font-normal text-muted-foreground">
            {totalSkills === 1 ? "skill" : "skills"}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-lg text-foreground">{totalMCP}</span>
          <span className="text-sm font-normal text-muted-foreground">
            {totalMCP === 1 ? "MCP server" : "MCP servers"}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills and MCP servers…"
          className="h-10 pl-9"
        />
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm font-normal text-muted-foreground">
          Loading plugins…
        </div>
      ) : !hasResults && isSearching ? (
        <div className="py-8 text-center text-sm font-normal text-muted-foreground">
          No results for &ldquo;{search}&rdquo;
        </div>
      ) : (
        <>
          {/* Skills section */}
          {filteredSkills.length > 0 ? (
            <div id="skills" className="mb-8">
              <h3 className="mb-3 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Skills
              </h3>
              <div className="divide-y divide-border rounded-lg border border-border">
                {filteredSkills.map((skill) => (
                  <div
                    key={skill.reference || skill.name}
                    className="px-4 py-3"
                  >
                    <div className="text-sm text-foreground">{skill.name}</div>
                    {skill.description ? (
                      <div className="mt-0.5 text-sm font-normal text-muted-foreground">
                        {skill.description}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* MCP section */}
          {filteredMCP.length > 0 ? (
            <div id="mcp" className="mb-8">
              <h3 className="mb-3 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                MCP Servers
              </h3>
              <div className="divide-y divide-border rounded-lg border border-border">
                {filteredMCP.map((server) => (
                  <div
                    key={server.name}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="text-sm text-foreground">{server.name}</div>
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-normal ${
                        server.configurationStatus === "configured"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-amber-500/15 text-amber-400"
                      }`}
                    >
                      {server.configurationStatus}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Empty sections when not searching */}
          {!isSearching &&
          filteredSkills.length === 0 &&
          filteredMCP.length === 0 ? (
            <div className="py-8 text-center text-sm font-normal text-muted-foreground">
              No skills or MCP servers discovered
            </div>
          ) : null}
        </>
      )}
    </SettingsPageLayout>
  )
}
