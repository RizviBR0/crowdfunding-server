import { Router } from "express";

import {
  createCreatorCampaign,
  deleteCreatorOwnedCampaign,
  getPublicDiscoverableCampaign,
  listPublicDiscoverableCampaigns,
  listTopFundedCampaigns,
  updateCreatorOwnedCampaign,
} from "../controllers/campaign.controller.js";
import { loadActiveUser, requireCreator, verifyAccessToken } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  campaignIdSchema,
  createCampaignSchema,
  listPublicCampaignsSchema,
  updateCampaignSchema,
} from "../validators/campaign.validation.js";

export const campaignRoutes = Router();

campaignRoutes.get("/top-funded", listTopFundedCampaigns);
campaignRoutes.get("/", validateRequest(listPublicCampaignsSchema), listPublicDiscoverableCampaigns);
campaignRoutes.get("/:campaignId", validateRequest(campaignIdSchema), getPublicDiscoverableCampaign);
campaignRoutes.post(
  "/",
  verifyAccessToken,
  loadActiveUser,
  requireCreator,
  validateRequest(createCampaignSchema),
  createCreatorCampaign,
);
campaignRoutes.patch(
  "/:campaignId",
  verifyAccessToken,
  loadActiveUser,
  requireCreator,
  validateRequest(updateCampaignSchema),
  updateCreatorOwnedCampaign,
);
campaignRoutes.delete(
  "/:campaignId",
  verifyAccessToken,
  loadActiveUser,
  requireCreator,
  validateRequest(campaignIdSchema),
  deleteCreatorOwnedCampaign,
);
