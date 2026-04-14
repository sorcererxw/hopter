import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import type { AuthService, AuthUser } from "../../services/auth-service.ts";
import { fail } from "../../../shared/contracts/api.ts";

declare module "hono" {
  interface ContextVariableMap {
    authUser: AuthUser | null;
  }
}

const UNPROTECTED_PREFIXES = [
  "/api/health",
  "/api/host/status",
  "/api/backends",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
];

export function createAuthMiddleware(authService: AuthService, cookieName: string): MiddlewareHandler {
  return async (c, next) => {
    const token = getCookie(c, cookieName) ?? null;
    const user = authService.getUserForToken(token);
    c.set("authUser", user);

    if (
      authService.isEnabled() &&
      c.req.path.startsWith("/api/") &&
      !UNPROTECTED_PREFIXES.includes(c.req.path) &&
      !user
    ) {
      return c.json(fail("AUTH_REQUIRED", "Authentication is required"), 401);
    }

    await next();
  };
}
