import { Router } from "express";
import { verifyAccessToken, loadActiveUser, requireRole } from "../middleware/auth.js";
import { createCheckoutSessionHandler, stripeWebhookHandler, getPaymentHistoryHandler } from "../controllers/paymentController.js";
import { validateCheckoutSessionRequest } from "../validators/payment.validation.js";

export const paymentRoutes = Router();

// Used by supporters to initiate a Stripe checkout
paymentRoutes.post("/checkout-session", verifyAccessToken, loadActiveUser, requireRole("supporter"), validateCheckoutSessionRequest, createCheckoutSessionHandler);

// Used by Stripe to notify us of successful payments (raw body parsed in app.js via verify)
paymentRoutes.post("/stripe/webhook", stripeWebhookHandler);

// Used by supporters to get their payment history
paymentRoutes.get("/history", verifyAccessToken, loadActiveUser, requireRole("supporter"), getPaymentHistoryHandler);
