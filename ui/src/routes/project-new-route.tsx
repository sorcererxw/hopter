import { useState, type FormEvent } from "react"
import { FolderPlus } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useCreateProject } from "@/features/projects/use-projects"

export function ProjectNewRoute() {
  const navigate = useNavigate()
  const createProject = useCreateProject()
  const [name, setName] = useState("")
  const [rootPath, setRootPath] = useState("")
  const [defaultBackend, setDefaultBackend] = useState("codex")

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!name.trim() || !rootPath.trim()) {
      return
    }

    await createProject.mutateAsync({
      name: name.trim(),
      rootPath: rootPath.trim(),
      defaultBackend: defaultBackend.trim() || "codex",
    })

    navigate("/")
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Project setup</p>
        <h2 className="text-3xl font-semibold tracking-tight">Register a local project</h2>
        <p className="text-sm text-muted-foreground">
          Projects are the local working directories available to new Codex sessions in the rebuilt workspace.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create project</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <Input
              data-testid="project-name-input"
              placeholder="Project name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              data-testid="project-root-input"
              placeholder="Absolute path, e.g. /Users/me/repo/tetris"
              value={rootPath}
              onChange={(event) => setRootPath(event.target.value)}
            />
            <Input
              data-testid="project-backend-input"
              placeholder="Default backend"
              value={defaultBackend}
              onChange={(event) => setDefaultBackend(event.target.value)}
            />
            <div className="flex items-center justify-between gap-3">
              <Button asChild variant="outline">
                <Link to="/">Cancel</Link>
              </Button>
              <Button
                type="submit"
                data-testid="project-create-submit"
                disabled={createProject.isPending || !name.trim() || !rootPath.trim()}
              >
                <FolderPlus className="size-4" />
                Create project
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
