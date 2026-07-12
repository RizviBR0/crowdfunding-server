import { ZodError } from "zod";

import { ApiError } from "../errors/ApiError.js";
import { sendError } from "../utils/apiResponse.js";

const normalizeError = (error) => {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new ApiError(400, "VALIDATION_ERROR", "Request validation failed.", error.flatten());
  }

  if (error.type === "entity.parse.failed") {
    return new ApiError(400, "INVALID_JSON", "Request body contains invalid JSON.");
  }

  if (error.statusCode === 403 && error.message === "Origin is not allowed.") {
    return new ApiError(403, "CORS_ORIGIN_DENIED", "Origin is not allowed.");
  }

  return new ApiError(500, "INTERNAL_SERVER_ERROR", "Unexpected server error.");
};

export const errorHandler = (error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const normalized = normalizeError(error);

  if (normalized.statusCode >= 500 && request.app.locals.config.nodeEnv !== "test") {
    console.error(error);
  }

  sendError(response, normalized);
};
