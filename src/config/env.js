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
    ADMIN_BOOTSTRAP_EMAILS: z.string().trim().default(""),
    FIREBASE_PROJECT_ID: z.string().trim().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().trim().optional(),
    FIREBASE_PRIVATE_KEY: z.string().optional(),
    ACCESS_TOKEN_SECRET: z.string().trim().min(16).default("development-access-token-secret"),
    ACCESS_TOKEN_EXPIRES_IN: z.string().trim().min(1).default("1h"),
    STRIPE_SECRET_KEY: z.string().trim().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().trim().optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && !value.MONGODB_URI) {
      context.addIssue({
        code: "custom",
        path: ["MONGODB_URI"],
        message: "MONGODB_URI is required in production.",
      });
    }
    if (value.NODE_ENV === "production" && !sourceHasProductionSecret(value.ACCESS_TOKEN_SECRET)) {
      context.addIssue({
        code: "custom",
        path: ["ACCESS_TOKEN_SECRET"],
        message: "ACCESS_TOKEN_SECRET must be set to a strong production secret.",
      });
    }
  });

const sourceHasProductionSecret = (secret) => secret !== "development-access-token-secret";

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
    adminBootstrapEmails: parsed.data.ADMIN_BOOTSTRAP_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    firebaseProjectId: parsed.data.FIREBASE_PROJECT_ID,
    firebaseClientEmail: parsed.data.FIREBASE_CLIENT_EMAIL,
    firebasePrivateKey: parsed.data.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    accessTokenSecret: parsed.data.ACCESS_TOKEN_SECRET,
    accessTokenExpiresIn: parsed.data.ACCESS_TOKEN_EXPIRES_IN,
    stripeSecretKey: parsed.data.STRIPE_SECRET_KEY || "",
    stripeWebhookSecret: parsed.data.STRIPE_WEBHOOK_SECRET || "",
  };
};

export const env = parseEnv();
