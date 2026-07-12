import "dotenv/config";

import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    API_PREFIX: z.string().trim().min(1).default("/api/v1"),
    CLIENT_ORIGIN: z.url().default("http://localhost:5173"),
    CORS_ORIGINS: z.string().trim().default("http://localhost:5173"),
    MONGODB_URI: z.string().trim().optional(),
    MONGODB_DB_NAME: z.string().trim().min(1).default("crowdfunding_platform"),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && !value.MONGODB_URI) {
      context.addIssue({
        code: "custom",
        path: ["MONGODB_URI"],
        message: "MONGODB_URI is required in production.",
      });
    }
  });

export const parseEnv = (source = process.env) => {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment configuration: ${message}`);
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    isProduction: parsed.data.NODE_ENV === "production",
    isTest: parsed.data.NODE_ENV === "test",
    port: parsed.data.PORT,
    apiPrefix: parsed.data.API_PREFIX,
    clientOrigin: parsed.data.CLIENT_ORIGIN,
    corsOrigins: parsed.data.CORS_ORIGINS,
    mongoUri: parsed.data.MONGODB_URI,
    mongoDbName: parsed.data.MONGODB_DB_NAME,
  };
};

export const env = parseEnv();
