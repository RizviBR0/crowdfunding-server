import { getDatabase } from "../config/database.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getTopFundedCampaigns } from "../services/campaign.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

export const listTopFundedCampaigns = asyncHandler(async (request, response) => {
  const databaseProvider = request.app.locals.getDatabase ?? getDatabase;
  const data = await getTopFundedCampaigns({
    database: databaseProvider(),
  });

  sendSuccess(response, 200, data);
});
