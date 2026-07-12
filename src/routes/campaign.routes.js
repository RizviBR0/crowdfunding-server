import { Router } from "express";

import { listTopFundedCampaigns } from "../controllers/campaign.controller.js";

export const campaignRoutes = Router();

campaignRoutes.get("/top-funded", listTopFundedCampaigns);
