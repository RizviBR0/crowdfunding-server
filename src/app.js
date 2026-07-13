import cors from "cors";
import express from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import { getDatabaseStatus } from "./config/database.js";
import { ApiError } from "./errors/ApiError.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFoundHandler } from "./middleware/notFoundHandler.js";
import { apiRoutes } from "./routes/index.js";

const parseOriginList = (config) => {
  const configuredOrigins = config.corsOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set(configuredOrigins.length > 0 ? configuredOrigins : [config.clientOrigin]);
};

export const createApp = ({
  config = env,
  databaseStatusProvider = getDatabaseStatus,
  databaseProvider,
  firebaseAuthProvider,
  configureRoutes,
} = {}) => {
  const app = express();
  const allowedOrigins = parseOriginList(config);

  app.locals.config = config;
  app.locals.getDatabaseStatus = databaseStatusProvider;
  if (databaseProvider) {
    app.locals.getDatabase = databaseProvider;
  }
  if (firebaseAuthProvider) {
    app.locals.getFirebaseAuth = firebaseAuthProvider;
  }

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }

        callback(new ApiError(403, "CORS_ORIGIN_DENIED", "Origin is not allowed."));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    }),
  );
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, res, buf) => {
        if (req.originalUrl.includes("/payments/stripe/webhook")) {
          req.rawBody = buf.toString();
        }
      },
    }),
  );

  app.use(config.apiPrefix, apiRoutes);

  if (configureRoutes) {
    configureRoutes(app);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
