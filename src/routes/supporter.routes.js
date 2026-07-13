import { Router } from "express";

import {
  getSupporterDashboardStats,
  listSupporterDashboardApprovedContributions,
  listSupporterOwnedContributions,
} from "../controllers/campaign.controller.js";
import { loadActiveUser, requireSupporter, verifyAccessToken } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  listSupporterApprovedContributionsSchema,
  listSupporterContributionsSchema,
  supporterContributionStatsSchema,
} from "../validators/campaign.validation.js";

export const supporterRoutes = Router();

supporterRoutes.use(verifyAccessToken, loadActiveUser, requireSupporter);

supporterRoutes.get(
  "/contributions/stats",
  validateRequest(supporterContributionStatsSchema),
  getSupporterDashboardStats,
);

supporterRoutes.get(
  "/contributions/approved",
  validateRequest(listSupporterApprovedContributionsSchema),
  listSupporterDashboardApprovedContributions,
);

supporterRoutes.get(
  "/contributions",
  validateRequest(listSupporterContributionsSchema),
  listSupporterOwnedContributions,
);
