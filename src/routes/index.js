import { Router } from "express";

import { authRoutes } from "./auth.routes.js";
import { campaignRoutes } from "./campaign.routes.js";
import { healthRoutes } from "./health.routes.js";

export const apiRoutes = Router();

apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/campaigns", campaignRoutes);
apiRoutes.use("/health", healthRoutes);
