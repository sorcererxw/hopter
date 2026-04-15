import { createClient } from "@connectrpc/connect"

import { HostService } from "@/gen/proto/orchd/v1/host_pb"
import { ProjectService } from "@/gen/proto/orchd/v1/project_pb"
import { SessionService } from "@/gen/proto/orchd/v1/session_pb"
import { transport } from "@/lib/connect/transport"

export const hostClient = createClient(HostService, transport)
export const projectClient = createClient(ProjectService, transport)
export const sessionClient = createClient(SessionService, transport)
