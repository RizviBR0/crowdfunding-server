import { Router } from "express";
import { getAdminAnalyticsHandler, getCreatorAnalyticsHandler, getSupporterAnalytics } from "../controllers/analytics.controller.js";
import { loadActiveUser, requireAdmin, requireCreator, requireSupporter, verifyAccessToken } from "../middleware/auth.js";

export const analyticsRoutes = Router();
analyticsRoutes.use(verifyAccessToken, loadActiveUser);
analyticsRoutes.get("/supporter", requireSupporter, getSupporterAnalytics);
analyticsRoutes.get("/creator", requireCreator, getCreatorAnalyticsHandler);
analyticsRoutes.get("/admin", requireAdmin, getAdminAnalyticsHandler);
