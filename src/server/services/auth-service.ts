import { createHash } from "node:crypto";
import type { AuthSessionRepository } from "../repositories/auth-session-repository.ts";
import { AppError } from "./errors.ts";

export type AuthUser = {
  id: "local-user";
  mode: "single-user";
};

const LOCAL_USER: AuthUser = {
  id: "local-user",
  mode: "single-user",
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class AuthService {
  constructor(
    private readonly repository: AuthSessionRepository,
    private readonly password: string | null,
    private readonly sessionTtlDays: number,
  ) {}

  isEnabled(): boolean {
    return Boolean(this.password);
  }

  async login(password: string): Promise<{ user: AuthUser; token: string }> {
    if (!this.password) {
      throw new AppError("AUTH_NOT_CONFIGURED", 503, "Single-user auth password is not configured");
    }

    if (password !== this.password) {
      throw new AppError("INVALID_CREDENTIALS", 401, "Invalid password");
    }

    const token = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionTtlDays * 24 * 60 * 60 * 1000);

    this.repository.create({
      id: crypto.randomUUID(),
      userId: LOCAL_USER.id,
      tokenHash: hashToken(token),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    return {
      user: LOCAL_USER,
      token,
    };
  }

  logout(token: string | null): void {
    if (!token) {
      return;
    }

    const session = this.repository.getByTokenHash(hashToken(token));
    if (session) {
      this.repository.deleteById(session.id);
    }
  }

  getUserForToken(token: string | null): AuthUser | null {
    if (!this.password) {
      return null;
    }

    if (!token) {
      return null;
    }

    this.repository.deleteExpired(new Date().toISOString());
    const session = this.repository.getByTokenHash(hashToken(token));
    if (!session) {
      return null;
    }

    return LOCAL_USER;
  }
}
