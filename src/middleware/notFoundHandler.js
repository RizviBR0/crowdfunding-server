import { ApiError } from "../errors/ApiError.js";

export const notFoundHandler = (request, response, next) => {
  next(new ApiError(404, "NOT_FOUND", `Route ${request.method} ${request.originalUrl} was not found.`));
};
