import { Router } from "express";

import { createSession, getCurrentUser } from "../controllers/auth.controller.js";
import { loadActiveUser, verifyAccessToken } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { sessionExchangeSchema } from "../validators/auth.validation.js";

export const authRoutes = Router();

authRoutes.post("/session", validateRequest(sessionExchangeSchema), createSession);
authRoutes.get("/me", verifyAccessToken, loadActiveUser, getCurrentUser);
