import { describe, expect, it } from "vitest";

import { parseEnv } from "../src/config/env.js";

describe("environment parsing", () => {
  it("uses safe development defaults", () => {
    const config = parseEnv({});

    expect(config).toMatchObject({
      nodeEnv: "development",
      port: 5000,
      apiPrefix: "/api/v1",
      clientOrigin: "http://localhost:5173",
      mongoDbName: "crowdfunding_platform",
    });
  });

  it("requires MongoDB configuration in production", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        CLIENT_ORIGIN: "https://example.com",
      }),
    ).toThrow("MONGODB_URI is required in production");
  });
});
