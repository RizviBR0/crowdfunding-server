import { Router } from "express";

import {
  decideCreatorReviewContribution,
  getCreatorReviewContribution,
  listCreatorOwnedCampaigns,
  listCreatorReviewContributions,
} from "../controllers/campaign.controller.js";
import { loadActiveUser, requireCreator, verifyAccessToken } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  creatorContributionDecisionSchema,
  creatorContributionIdSchema,
  listCreatorCampaignsSchema,
  listCreatorContributionsSchema,
} from "../validators/campaign.validation.js";

export const creatorRoutes = Router();

creatorRoutes.get(
  "/campaigns",
  verifyAccessToken,
  loadActiveUser,
  requireCreator,
  validateRequest(listCreatorCampaignsSchema),
  listCreatorOwnedCampaigns,
);

creatorRoutes.get(
  "/contributions/pending",
  verifyAccessToken,
  loadActiveUser,
  requireCreator,
  validateRequest(listCreatorContributionsSchema),
  listCreatorReviewContributions,
);

creatorRoutes.get(
  "/contributions/:contributionId",
  verifyAccessToken,
  loadActiveUser,
  requireCreator,
  validateRequest(creatorContributionIdSchema),
  getCreatorReviewContribution,
);

creatorRoutes.patch(
  "/contributions/:contributionId/decision",
  verifyAccessToken,
  loadActiveUser,
  requireCreator,
  validateRequest(creatorContributionDecisionSchema),
  decideCreatorReviewContribution,
);
