import { createClient } from "@connectrpc/connect"

import { ConfigService } from "@/gen/proto/hopter/v1/config_pb"
import { GitService } from "@/gen/proto/hopter/v1/git_pb"
import { HostService } from "@/gen/proto/hopter/v1/host_pb"
import { ProjectService } from "@/gen/proto/hopter/v1/project_pb"
import { SessionService } from "@/gen/proto/hopter/v1/session_pb"
import { TaskService } from "@/gen/proto/hopter/v1/tasks_pb"
import { TerminalService } from "@/gen/proto/hopter/v1/terminal_pb"
import { transport } from "@/lib/connect/transport"

export const hostClient = createClient(HostService, transport)
export const configClient = createClient(ConfigService, transport)
export const gitClient = createClient(GitService, transport)
export const projectClient = createClient(ProjectService, transport)
export const sessionClient = createClient(SessionService, transport)
export const taskClient = createClient(TaskService, transport)
export const terminalClient = createClient(TerminalService, transport)
