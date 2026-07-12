import jwt from "jsonwebtoken";

import { ApiError } from "../errors/ApiError.js";

export const signAccessToken = ({ user, config }) =>
  jwt.sign(
    {
      email: user.email,
    },
    config.accessTokenSecret,
    {
      subject: user.id,
      expiresIn: config.accessTokenExpiresIn,
    },
  );

export const verifyAccessTokenValue = ({ token, config }) => {
  try {
    return jwt.verify(token, config.accessTokenSecret);
  } catch {
    throw new ApiError(401, "INVALID_ACCESS_TOKEN", "Access token is invalid or expired.");
  }
};
