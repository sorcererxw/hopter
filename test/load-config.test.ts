import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/server/config/load-config.ts";

describe("loadConfig", () => {
  test("loads defaults", () => {
    const config = loadConfig({
      cwd: "/tmp/orchd-config",
      env: {},
    });

    expect(config.server.port).toBe(8787);
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.server.accessMode).toBe("local_only");
    expect(config.storage.artifactsDir).toContain("/tmp/orchd-config/storage/artifacts");
  });

  test("fails fast on invalid port", () => {
    expect(() =>
      loadConfig({
        env: { ORCHD_PORT: "0" },
      })).toThrow("Invalid integer config for ORCHD_PORT");
  });

  test("accepts explicit LAN host override", () => {
    const config = loadConfig({
      env: { ORCHD_HOST: "0.0.0.0" },
    });

    expect(config.server.host).toBe("0.0.0.0");
  });
});
