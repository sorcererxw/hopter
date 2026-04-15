import { Hono } from "hono";

import { fail, ok } from "../../../shared/contracts/api.ts";
import type { HostFilesystemService } from "../../services/host-filesystem-service.ts";
import { AppError } from "../../services/errors.ts";

export function createHostFilesystemRoutes(hostFilesystemService: HostFilesystemService): Hono {
  const app = new Hono();

  app.get("/host/fs/roots", (c) => {
    return c.json(ok({ items: hostFilesystemService.roots() }));
  });

  app.get("/host/fs/recent-repos", (c) => {
    return c.json(ok({ items: hostFilesystemService.recentRepos() }));
  });

  app.get("/host/fs/list", (c) => {
    try {
      const pathParam = c.req.query("path") ?? undefined;
      return c.json(ok(hostFilesystemService.listDirectory(pathParam)));
    } catch (error) {
      if (error instanceof AppError) {
        c.status(error.status as never);
        return c.json(fail(error.code, error.message));
      }
      throw error;
    }
  });

  return app;
}
