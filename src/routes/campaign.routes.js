import { Router } from "express";

import {
  createCreatorCampaign,
  deleteCreatorOwnedCampaign,
  listTopFundedCampaigns,
  updateCreatorOwnedCampaign,
} from "../controllers/campaign.controller.js";
import { loadActiveUser, requireCreator, verifyAccessToken } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  campaignIdSchema,
  createCampaignSchema,
  updateCampaignSchema,
} from "../validators/campaign.validation.js";

export const campaignRoutes = Router();

campaignRoutes.get("/top-funded", listTopFundedCampaigns);
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
