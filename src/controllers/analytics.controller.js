import { getDatabase } from "../config/database.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getAdminAnalytics, getCreatorAnalytics } from "../services/analytics.service.js";
import { getSupporterContributionStats } from "../services/campaign.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

const getRequestDatabase = (request) => (request.app.locals.getDatabase ?? getDatabase)();

export const getSupporterAnalytics = asyncHandler(async (request, response) => {
  const stats = await getSupporterContributionStats({ database: getRequestDatabase(request), user: request.user });
  sendSuccess(response, 200, { stats });
});

export const getCreatorAnalyticsHandler = asyncHandler(async (request, response) => {
  const stats = await getCreatorAnalytics({ database: getRequestDatabase(request), creatorId: request.user.id });
  sendSuccess(response, 200, { stats });
});

export const getAdminAnalyticsHandler = asyncHandler(async (request, response) => {
  const stats = await getAdminAnalytics({ database: getRequestDatabase(request) });
  sendSuccess(response, 200, { stats });
});
