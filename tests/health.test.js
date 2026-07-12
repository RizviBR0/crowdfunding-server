import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

describe("health endpoint", () => {
  it("returns the standard success envelope with process and database status", async () => {
    const app = createApp({
      databaseStatusProvider: () => ({ status: "connected", lastError: null }),
    });

    const response = await request(app).get("/api/v1/health").expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        status: "ok",
        database: "connected",
      },
    });
    expect(new Date(response.body.data.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("sets CORS headers for an allowed browser origin", async () => {
    const app = createApp();

    const response = await request(app)
      .get("/api/v1/health")
      .set("Origin", "http://localhost:5173")
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});
