import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createApp } from "../src/app.js";
import { validateRequest } from "../src/middleware/validateRequest.js";
import { sendSuccess } from "../src/utils/apiResponse.js";

const validationSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
  }),
  params: z.object({}),
  query: z.object({}),
  headers: z.object({}).passthrough(),
});

describe("error and validation envelopes", () => {
  it("returns the standard error envelope for unknown routes", async () => {
    const app = createApp();

    const response = await request(app).get("/api/v1/missing").expect(404);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "NOT_FOUND",
      },
    });
  });

  it("normalizes validation failures before route handlers run", async () => {
    const app = createApp({
      configureRoutes(application) {
        application.post("/api/v1/test-validation", validateRequest(validationSchema), (request, response) => {
          sendSuccess(response, 200, { name: request.validated.body.name });
        });
      },
    });

    const response = await request(app).post("/api/v1/test-validation").send({ name: "" }).expect(400);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
      },
    });
  });
});
