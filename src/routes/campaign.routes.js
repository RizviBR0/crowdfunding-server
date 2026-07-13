import { Router } from "express";

import {
  createCreatorCampaign,
  createSupporterContribution,
  deleteCreatorOwnedCampaign,
  getPublicDiscoverableCampaign,
  listPublicDiscoverableCampaigns,
  listTopFundedCampaigns,
  updateCreatorOwnedCampaign,
} from "../controllers/campaign.controller.js";
import { loadActiveUser, requireCreator, requireSupporter, verifyAccessToken } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { createSupporterReport } from "../controllers/report.controller.js";
import { createReportSchema } from "../validators/report.validation.js";
import {
  campaignIdSchema,
  createCampaignSchema,
  createContributionSchema,
  listPublicCampaignsSchema,
  updateCampaignSchema,
} from "../validators/campaign.validation.js";

export const campaignRoutes = Router();

campaignRoutes.get("/top-funded", listTopFundedCampaigns);
campaignRoutes.get("/", validateRequest(listPublicCampaignsSchema), listPublicDiscoverableCampaigns);
campaignRoutes.get("/:campaignId", validateRequest(campaignIdSchema), getPublicDiscoverableCampaign);
campaignRoutes.post(
  "/:campaignId/contributions",
  verifyAccessToken,
  loadActiveUser,
  requireSupporter,
  validateRequest(createContributionSchema),
  createSupporterContribution,
);
campaignRoutes.post(
  "/:campaignId/reports",
  verifyAccessToken,
  loadActiveUser,
  requireSupporter,
  validateRequest(createReportSchema),
  createSupporterReport,
);
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
