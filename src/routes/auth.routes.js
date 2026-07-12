import { Router } from "express";

import { createSession } from "../controllers/auth.controller.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { sessionExchangeSchema } from "../validators/auth.validation.js";

export const authRoutes = Router();

authRoutes.post("/session", validateRequest(sessionExchangeSchema), createSession);
