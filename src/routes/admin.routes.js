import { Router } from "express";

import {
  deleteAdminManagedCampaign,
  decideAdminManagedCampaign,
  listAdminManagedCampaigns,
  suspendAdminManagedCampaign,
} from "../controllers/campaign.controller.js";
import {
  approveAdminWithdrawal,
  listAdminWithdrawals,
  rejectAdminWithdrawal,
} from "../controllers/withdrawal.controller.js";
import { loadActiveUser, requireAdmin, verifyAccessToken } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { listAdminUsers, removeAdminUser, updateAdminUserRole } from "../controllers/user.controller.js";
import { listUsersSchema, updateUserRoleSchema, userIdSchema } from "../validators/user.validation.js";
import { listAdminReports, resolveAdminReport } from "../controllers/report.controller.js";
import { listReportsSchema, resolveReportSchema } from "../validators/report.validation.js";
import {
  adminCampaignDecisionSchema,
  adminCampaignDeleteSchema,
  adminCampaignSuspendSchema,
  listAdminCampaignsSchema,
} from "../validators/campaign.validation.js";
import {
  approveWithdrawalSchema,
  listAdminWithdrawalsSchema,
} from "../validators/withdrawal.validation.js";

export const adminRoutes = Router();

adminRoutes.use(verifyAccessToken, loadActiveUser, requireAdmin);

adminRoutes.get("/campaigns", validateRequest(listAdminCampaignsSchema), listAdminManagedCampaigns);
adminRoutes.patch(
  "/campaigns/:campaignId/decision",
  validateRequest(adminCampaignDecisionSchema),
  decideAdminManagedCampaign,
);

adminRoutes.get("/users", validateRequest(listUsersSchema), listAdminUsers);
adminRoutes.patch("/users/:userId/role", validateRequest(updateUserRoleSchema), updateAdminUserRole);
adminRoutes.delete("/users/:userId", validateRequest(userIdSchema), removeAdminUser);
adminRoutes.get("/reports", validateRequest(listReportsSchema), listAdminReports);
adminRoutes.patch("/reports/:reportId", validateRequest(resolveReportSchema), resolveAdminReport);
adminRoutes.patch(
  "/campaigns/:campaignId/suspend",
  validateRequest(adminCampaignSuspendSchema),
  suspendAdminManagedCampaign,
);
adminRoutes.delete("/campaigns/:campaignId", validateRequest(adminCampaignDeleteSchema), deleteAdminManagedCampaign);

adminRoutes.get("/withdrawals", validateRequest(listAdminWithdrawalsSchema), listAdminWithdrawals);
adminRoutes.patch(
  "/withdrawals/:withdrawalId/approve",
  validateRequest(approveWithdrawalSchema),
  approveAdminWithdrawal,
);
adminRoutes.patch(
  "/withdrawals/:withdrawalId/reject",
  validateRequest(approveWithdrawalSchema), // Reuses idempotency-key and id validation schema
  rejectAdminWithdrawal,
);
