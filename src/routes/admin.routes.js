import { Router } from "express";

import {
  deleteAdminManagedCampaign,
  decideAdminManagedCampaign,
  listAdminManagedCampaigns,
  suspendAdminManagedCampaign,
} from "../controllers/campaign.controller.js";
import { loadActiveUser, requireAdmin, verifyAccessToken } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  adminCampaignDecisionSchema,
  adminCampaignDeleteSchema,
  adminCampaignSuspendSchema,
  listAdminCampaignsSchema,
} from "../validators/campaign.validation.js";

export const adminRoutes = Router();

adminRoutes.use(verifyAccessToken, loadActiveUser, requireAdmin);

adminRoutes.get("/campaigns", validateRequest(listAdminCampaignsSchema), listAdminManagedCampaigns);
adminRoutes.patch(
  "/campaigns/:campaignId/decision",
  validateRequest(adminCampaignDecisionSchema),
  decideAdminManagedCampaign,
);
adminRoutes.patch(
  "/campaigns/:campaignId/suspend",
  validateRequest(adminCampaignSuspendSchema),
  suspendAdminManagedCampaign,
);
adminRoutes.delete("/campaigns/:campaignId", validateRequest(adminCampaignDeleteSchema), deleteAdminManagedCampaign);
