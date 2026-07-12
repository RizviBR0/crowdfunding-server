import { Router } from "express";

import { listCreatorOwnedCampaigns } from "../controllers/campaign.controller.js";
import { loadActiveUser, requireCreator, verifyAccessToken } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { listCreatorCampaignsSchema } from "../validators/campaign.validation.js";

export const creatorRoutes = Router();

creatorRoutes.get(
  "/campaigns",
  verifyAccessToken,
  loadActiveUser,
  requireCreator,
  validateRequest(listCreatorCampaignsSchema),
  listCreatorOwnedCampaigns,
);
