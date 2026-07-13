import Stripe from "stripe";
import { env } from "../config/env.js";
import { getDatabase } from "../config/database.js";
import { ApiError } from "../errors/ApiError.js";

const stripe = env.stripeSecretKey ? new Stripe(env.stripeSecretKey, { apiVersion: "2024-04-10" }) : null;

export const CREDIT_PACKAGES = {
  package_100: { id: "package_100", credits: 100, amountCents: 1000 }, // $10
  package_300: { id: "package_300", credits: 300, amountCents: 2500 }, // $25
  package_800: { id: "package_800", credits: 800, amountCents: 6000 }, // $60
  package_1500: { id: "package_1500", credits: 1500, amountCents: 11000 }, // $110
};

export const createCheckoutSession = async (user, packageId) => {
  const pkg = CREDIT_PACKAGES[packageId];
  if (!pkg) {
    throw new ApiError(400, "INVALID_PACKAGE", "The selected credit package is invalid.");
  }

  if (!stripe) {
    throw new ApiError(503, "PAYMENT_SERVICE_UNAVAILABLE", "Payments are not configured on this server.");
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    customer_email: user.email,
    client_reference_id: user.id.toString(),
    metadata: {
      userId: user.id.toString(),
      packageId: pkg.id,
      credits: pkg.credits.toString(),
    },
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${pkg.credits} FundBloom Credits`,
            description: `Purchase ${pkg.credits} credits to support campaigns.`,
          },
          unit_amount: pkg.amountCents,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: `${env.clientOrigin}/dashboard/supporter/payments/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.clientOrigin}/dashboard/supporter/credits`,
  });

  return {
    sessionId: session.id,
    checkoutUrl: session.url,
  };
};

export const handleStripeWebhook = async (signature, rawBody) => {
  if (!stripe || !env.stripeWebhookSecret) {
    throw new ApiError(503, "PAYMENT_SERVICE_UNAVAILABLE", "Payments are not configured on this server.");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
  } catch (err) {
    throw new ApiError(400, "WEBHOOK_VERIFICATION_FAILED", `Webhook signature verification failed: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    await processCheckoutSession(event.data.object, event.id);
  }

  return { received: true };
};

const processCheckoutSession = async (session, eventId) => {
  const db = getDatabase();
  const userId = session.client_reference_id;
  const packageId = session.metadata.packageId;
  const creditsStr = session.metadata.credits;
  
  if (!userId || !packageId || !creditsStr) {
    console.error("Missing metadata in checkout session", session.id);
    return;
  }

  const credits = parseInt(creditsStr, 10);
  const amountCents = session.amount_total;

  const sessionClient = getDatabase().client;
  const transactionOptions = {
    readPreference: "primary",
    readConcern: { level: "local" },
    writeConcern: { w: "majority" },
  };

  const mongoSession = sessionClient.startSession();

  try {
    await mongoSession.withTransaction(async () => {
      // 1. Check if event is already processed (Idempotency)
      const existingPayment = await db.collection("payments").findOne(
        { stripeSessionId: session.id },
        { session: mongoSession }
      );

      if (existingPayment) {
        return; // Already processed
      }

      const { ObjectId } = await import("mongodb");
      const userObjectId = new ObjectId(userId);
      
      const user = await db.collection("users").findOne({ _id: userObjectId }, { session: mongoSession });
      if (!user) {
        throw new Error("User not found for payment");
      }

      // 2. Insert Payment
      const paymentDoc = {
        supporterId: userObjectId,
        supporterEmail: user.email,
        packageId,
        credits,
        amountCents,
        currency: "usd",
        stripeSessionId: session.id,
        stripePaymentIntentId: session.payment_intent,
        stripeEventId: eventId,
        status: "paid",
        creditedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.collection("payments").insertOne(paymentDoc, { session: mongoSession });

      // 3. Grant Credits to User
      const newBalance = (user.credits || 0) + credits;
      await db.collection("users").updateOne(
        { _id: userObjectId },
        { $inc: { credits } },
        { session: mongoSession }
      );

      // 4. Record Ledger entry
      const ledgerEntry = {
        userId: userObjectId,
        type: "stripe_purchase",
        amount: credits,
        balanceType: "credits",
        referenceType: "payment",
        referenceId: session.id,
        idempotencyKey: eventId,
        balanceAfter: newBalance,
        createdAt: new Date(),
        metadata: {
          packageId,
          amountCents,
        }
      };

      await db.collection("creditTransactions").insertOne(ledgerEntry, { session: mongoSession });
    }, transactionOptions);
  } finally {
    await mongoSession.endSession();
  }
};
