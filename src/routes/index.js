import { Router } from "express";

import { adminRoutes } from "./admin.routes.js";
import { authRoutes } from "./auth.routes.js";
import { campaignRoutes } from "./campaign.routes.js";
import { creatorRoutes } from "./creator.routes.js";
import { healthRoutes } from "./health.routes.js";
import { paymentRoutes } from "./paymentRoutes.js";
import { supporterRoutes } from "./supporter.routes.js";

export const apiRoutes = Router();

apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/admin", adminRoutes);
apiRoutes.use("/campaigns", campaignRoutes);
apiRoutes.use("/creator", creatorRoutes);
apiRoutes.use("/health", healthRoutes);
apiRoutes.use("/payments", paymentRoutes);
apiRoutes.use("/supporter", supporterRoutes);

