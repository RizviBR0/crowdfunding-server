import { asyncHandler } from "../middleware/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";

export const getHealth = asyncHandler(async (request, response) => {
  const database = request.app.locals.getDatabaseStatus();

  sendSuccess(response, 200, {
    status: "ok",
    database: database.status,
    timestamp: new Date().toISOString(),
  });
});
