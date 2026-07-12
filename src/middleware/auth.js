import { ObjectId } from "mongodb";

import { getDatabase } from "../config/database.js";
import { env } from "../config/env.js";
import { ApiError } from "../errors/ApiError.js";
import { publicUser } from "../services/auth.service.js";
import { verifyAccessTokenValue } from "../services/token.service.js";

const parseBearerToken = (authorizationHeader) => {
  if (!authorizationHeader) {
    throw new ApiError(401, "AUTH_TOKEN_REQUIRED", "Authorization bearer token is required.");
  }

  const [scheme, token, ...extra] = authorizationHeader.split(" ");

  if (scheme !== "Bearer" || !token || extra.length > 0) {
    throw new ApiError(401, "INVALID_AUTH_HEADER", "Authorization header must use Bearer token format.");
  }

  return token;
};

const userIdFilter = (userId) => (ObjectId.isValid(userId) ? { _id: new ObjectId(userId) } : { _id: userId });

export const verifyAccessToken = (request, response, next) => {
  try {
    const config = request.app.locals.config ?? env;
    const token = parseBearerToken(request.headers.authorization);

    request.auth = verifyAccessTokenValue({ token, config });
    next();
  } catch (error) {
    next(error);
  }
};

export const loadActiveUser = async (request, response, next) => {
  try {
    const databaseProvider = request.app.locals.getDatabase ?? getDatabase;
    const userId = request.auth?.sub;

    if (!userId) {
      throw new ApiError(401, "INVALID_ACCESS_TOKEN", "Access token is missing a user subject.");
    }

    const user = await databaseProvider().collection("users").findOne(userIdFilter(userId));

    if (!user || user.status !== "active") {
      throw new ApiError(401, "USER_NOT_ACTIVE", "Authenticated user is not active.");
    }

    request.user = publicUser(user);
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole = (...allowedRoles) => (request, response, next) => {
  if (!request.user) {
    next(new ApiError(401, "AUTH_USER_REQUIRED", "Authenticated user context is required."));
    return;
  }

  if (!allowedRoles.includes(request.user.role)) {
    next(new ApiError(403, "ROLE_FORBIDDEN", "You do not have permission to access this resource."));
    return;
  }

  next();
};

export const requireSupporter = requireRole("supporter");
export const requireCreator = requireRole("creator");
export const requireAdmin = requireRole("admin");
