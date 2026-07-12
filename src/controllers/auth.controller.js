import { getDatabase } from "../config/database.js";
import { env } from "../config/env.js";
import { getFirebaseAuth } from "../config/firebaseAdmin.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { exchangeFirebaseSession } from "../services/auth.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

export const createSession = asyncHandler(async (request, response) => {
  const config = request.app.locals.config ?? env;
  const databaseProvider = request.app.locals.getDatabase ?? getDatabase;
  const firebaseAuthProvider = request.app.locals.getFirebaseAuth ?? (() => getFirebaseAuth(config));

  const result = await exchangeFirebaseSession({
    firebaseIdToken: request.validated.body.firebaseIdToken,
    intendedRole: request.validated.body.intendedRole,
    database: databaseProvider(),
    firebaseAuth: firebaseAuthProvider(),
    adminBootstrapEmails: config.adminBootstrapEmails,
  });

  sendSuccess(response, result.isNewUser ? 201 : 200, {
    user: result.user,
  });
});
