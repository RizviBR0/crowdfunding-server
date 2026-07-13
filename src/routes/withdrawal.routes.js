import { Router } from "express";
import { createCreatorWithdrawal } from "../controllers/withdrawal.controller.js";
import { loadActiveUser, requireCreator, verifyAccessToken } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { createWithdrawalSchema } from "../validators/withdrawal.validation.js";

export const withdrawalRoutes = Router();

withdrawalRoutes.post(
  "/",
  verifyAccessToken,
  loadActiveUser,
  requireCreator,
  validateRequest(createWithdrawalSchema),
  createCreatorWithdrawal,
);
