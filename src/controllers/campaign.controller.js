import { getDatabase } from "../config/database.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  createCampaign,
  decideCampaignAsAdmin,
  deleteCampaignAsAdmin,
  deleteCreatorCampaign,
  getPublicCampaignDetail,
  getTopFundedCampaigns,
  listAdminCampaigns,
  listCreatorCampaigns,
  listPublicCampaigns,
  suspendCampaignAsAdmin,
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

export const listPublicDiscoverableCampaigns = asyncHandler(async (request, response) => {
  const { page, limit, ...filters } = request.validated.query;
  const result = await listPublicCampaigns({
    database: getRequestDatabase(request),
    page,
    limit,
    filters,
  });

  sendSuccess(response, 200, { campaigns: result.data }, result.meta);
});

export const getPublicDiscoverableCampaign = asyncHandler(async (request, response) => {
  const campaign = await getPublicCampaignDetail({
    database: getRequestDatabase(request),
    campaignId: request.validated.params.campaignId,
  });

  sendSuccess(response, 200, { campaign });
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

export const listAdminManagedCampaigns = asyncHandler(async (request, response) => {
  const { status, search, page, limit } = request.validated.query;
  const result = await listAdminCampaigns({
    database: getRequestDatabase(request),
    status,
    search,
    page,
    limit,
  });

  sendSuccess(response, 200, { campaigns: result.data }, result.meta);
});

export const decideAdminManagedCampaign = asyncHandler(async (request, response) => {
  const campaign = await decideCampaignAsAdmin({
    database: getRequestDatabase(request),
    admin: request.user,
    campaignId: request.validated.params.campaignId,
    input: request.validated.body,
  });

  sendSuccess(response, 200, { campaign });
});

export const suspendAdminManagedCampaign = asyncHandler(async (request, response) => {
  const campaign = await suspendCampaignAsAdmin({
    database: getRequestDatabase(request),
    admin: request.user,
    campaignId: request.validated.params.campaignId,
    reason: request.validated.body.reason,
  });

  sendSuccess(response, 200, { campaign });
});

export const deleteAdminManagedCampaign = asyncHandler(async (request, response) => {
  const result = await deleteCampaignAsAdmin({
    database: getRequestDatabase(request),
    admin: request.user,
    campaignId: request.validated.params.campaignId,
    reason: request.validated.body.reason,
  });

  sendSuccess(response, 200, result);
});
