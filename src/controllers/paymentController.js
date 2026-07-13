import { createCheckoutSession, handleStripeWebhook } from "../services/paymentService.js";

export const createCheckoutSessionHandler = async (req, res, next) => {
  try {
    const { packageId } = req.body;
    // req.user is guaranteed by requireAuth
    const result = await createCheckoutSession(req.user, packageId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const stripeWebhookHandler = async (req, res, next) => {
  try {
    const signature = req.headers["stripe-signature"];
    const rawBody = req.rawBody;

    const result = await handleStripeWebhook(signature, rawBody);
    res.status(200).json(result);
  } catch (err) {
    // Note: webhooks should often return generic errors to Stripe, but next(err) relies on errorHandler
    next(err);
  }
};
