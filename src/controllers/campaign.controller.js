import { getDatabase } from "../config/database.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  createCampaign,
  deleteCreatorCampaign,
  getTopFundedCampaigns,
  listCreatorCampaigns,
  updateCreatorCampaign,
} from "../services/campaign.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

const getRequestDatabase = (request) => {
  const databaseProvider = request.app.locals.getDatabase ?? getDatabase;

  return databaseProvider();
};

export const listTopFundedCampaigns = asyncHandler(async (request, response) => {
  const data = await getTopFundedCampaigns({
    database: getRequestDatabase(request),
  });

  sendSuccess(response, 200, data);
});

export const createCreatorCampaign = asyncHandler(async (request, response) => {
  const campaign = await createCampaign({
    database: getRequestDatabase(request),
    user: request.user,
    input: request.validated.body,
  });

  sendSuccess(response, 201, { campaign });
});

export const listCreatorOwnedCampaigns = asyncHandler(async (request, response) => {
  const { page, limit } = request.validated.query;
  const result = await listCreatorCampaigns({
    database: getRequestDatabase(request),
    user: request.user,
    page,
    limit,
  });

  sendSuccess(response, 200, { campaigns: result.data }, result.meta);
});

export const updateCreatorOwnedCampaign = asyncHandler(async (request, response) => {
  const campaign = await updateCreatorCampaign({
    database: getRequestDatabase(request),
    user: request.user,
    campaignId: request.validated.params.campaignId,
    input: request.validated.body,
  });

  sendSuccess(response, 200, { campaign });
});

export const deleteCreatorOwnedCampaign = asyncHandler(async (request, response) => {
  const result = await deleteCreatorCampaign({
    database: getRequestDatabase(request),
    user: request.user,
    campaignId: request.validated.params.campaignId,
  });

  sendSuccess(response, 200, result);
});
