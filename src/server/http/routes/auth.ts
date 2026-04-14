import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { fail, ok } from "../../../shared/contracts/api.ts";
import type { AuthService } from "../../services/auth-service.ts";
import { AppError } from "../../services/errors.ts";

export function createAuthRoutes(authService: AuthService, cookieName: string, secureCookie: boolean): Hono {
  const app = new Hono();

  app.post("/login", async (c) => {
    try {
      const body = await c.req.json<{ password?: string }>();
      const result = await authService.login(body.password ?? "");

      setCookie(c, cookieName, result.token, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        secure: secureCookie,
      });

      return c.json(ok({ user: result.user }));
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(fail(error.code, error.message), error.status);
      }

      throw error;
    }
  });

  app.post("/logout", (c) => {
    const token = getCookie(c, cookieName) ?? null;
    authService.logout(token);
    deleteCookie(c, cookieName, { path: "/" });
    return c.json(ok({ loggedOut: true }));
  });

  app.get("/me", (c) => {
    const user = c.get("authUser");
    return c.json(ok({
      authenticated: Boolean(user),
      user,
      required: authService.isEnabled(),
    }));
  });

  return app;
}
