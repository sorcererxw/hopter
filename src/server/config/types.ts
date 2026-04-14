export type AccessMode = "local_only" | "self_managed_remote";

export type AppConfig = {
  server: {
    host: string;
    port: number;
    trustProxy: boolean;
    accessMode: AccessMode;
    hostId: string;
  };
  storage: {
    rootDir: string;
    dbPath: string;
    artifactsDir: string;
    validationDir: string;
    webDistDir: string;
    webSourceDir: string;
  };
  auth: {
    password: string | null;
    cookieName: string;
    sessionTtlDays: number;
  };
  projects: {
    allowlist: string[] | null;
  };
  codex: {
    minVersion: string;
  };
};
