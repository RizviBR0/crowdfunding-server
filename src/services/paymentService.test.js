import { describe, expect, it, vi, beforeEach } from "vitest";
import { CREDIT_PACKAGES, createCheckoutSession, handleStripeWebhook } from "./paymentService.js";
import { getDatabase } from "../config/database.js";
import { ApiError } from "../errors/ApiError.js";

vi.mock("../config/database.js", () => ({
  getDatabase: vi.fn(),
}));

vi.mock("../config/env.js", () => ({
  env: {
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
    clientOrigin: "http://localhost:5173",
  },
}));

const { mockCreate, mockConstructEvent } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockConstructEvent: vi.fn(),
}));

vi.mock("stripe", () => {
  class StripeMock {
    constructor() {
      this.checkout = { sessions: { create: mockCreate } };
      this.webhooks = { constructEvent: mockConstructEvent };
    }
  }
  return { default: StripeMock };
});

describe("paymentService", () => {
  describe("CREDIT_PACKAGES", () => {
    it("defines the exact required packages", () => {
      expect(CREDIT_PACKAGES.package_100.credits).toBe(100);
      expect(CREDIT_PACKAGES.package_100.amountCents).toBe(1000); // $10
      expect(CREDIT_PACKAGES.package_1500.credits).toBe(1500);
      expect(CREDIT_PACKAGES.package_1500.amountCents).toBe(11000); // $110
    });
  });

  describe("createCheckoutSession", () => {
    it("throws an error for an invalid package", async () => {
      await expect(createCheckoutSession({ id: "user_1" }, "invalid_pkg")).rejects.toThrow(ApiError);
    });

    it("creates a stripe checkout session for a valid package", async () => {
      mockCreate.mockResolvedValueOnce({
        id: "cs_test_123",
        url: "https://checkout.stripe.com/pay/cs_test_123",
      });

      const user = { id: "user_1", email: "test@example.com" };
      const result = await createCheckoutSession(user, "package_300");

      expect(result.sessionId).toBe("cs_test_123");
      expect(result.checkoutUrl).toBe("https://checkout.stripe.com/pay/cs_test_123");
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_email: "test@example.com",
          client_reference_id: "user_1",
          metadata: { userId: "user_1", packageId: "package_300", credits: "300" },
        })
      );
    });
  });
  
  describe("handleStripeWebhook", () => {
    let dbMock, mongoSessionMock, clientMock;

    beforeEach(() => {
      vi.clearAllMocks();
      
      mongoSessionMock = {
        withTransaction: vi.fn(async (cb) => { await cb(); }),
        endSession: vi.fn(),
      };

      clientMock = {
        startSession: vi.fn(() => mongoSessionMock),
      };

      const collectionMocks = {
        payments: { findOne: vi.fn(), insertOne: vi.fn() },
        users: { findOne: vi.fn(), updateOne: vi.fn() },
        creditTransactions: { insertOne: vi.fn() },
      };

      dbMock = {
        client: clientMock,
        collection: vi.fn((name) => collectionMocks[name]),
      };

      getDatabase.mockReturnValue(dbMock);
    });

    it("throws an error if signature verification fails", async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      await expect(handleStripeWebhook("bad_sig", "body")).rejects.toThrow(ApiError);
    });

    it("processes checkout.session.completed and grants credits exactly once", async () => {
      const mockEvent = {
        id: "evt_123",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_123",
            client_reference_id: "000000000000000000000001",
            amount_total: 2500,
            payment_intent: "pi_123",
            metadata: { packageId: "package_300", credits: "300" },
          },
        },
      };
      mockConstructEvent.mockReturnValue(mockEvent);

      dbMock.collection("payments").findOne.mockResolvedValueOnce(null); // not processed
      dbMock.collection("users").findOne.mockResolvedValueOnce({ _id: "000000000000000000000001", email: "supporter@test.com", credits: 50 });

      const result = await handleStripeWebhook("valid_sig", "rawbody");
      
      expect(result.received).toBe(true);

      // Verify db updates
      expect(dbMock.collection("payments").insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeSessionId: "cs_test_123",
          credits: 300,
          status: "paid",
        }),
        expect.any(Object)
      );

      expect(dbMock.collection("users").updateOne).toHaveBeenCalledWith(
        { _id: expect.anything() },
        { $inc: { credits: 300 } },
        expect.any(Object)
      );

      expect(dbMock.collection("creditTransactions").insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "stripe_purchase",
          amount: 300,
          balanceAfter: 350,
          idempotencyKey: "evt_123",
        }),
        expect.any(Object)
      );
    });

    it("skips processing if the payment is already recorded", async () => {
      const mockEvent = {
        id: "evt_123",
        type: "checkout.session.completed",
        data: { object: { id: "cs_test_123", client_reference_id: "1", metadata: { packageId: "package_300", credits: "300" } } },
      };

      mockConstructEvent.mockReturnValue(mockEvent);

      dbMock.collection("payments").findOne.mockResolvedValueOnce({ _id: "payment1" }); // already processed

      await handleStripeWebhook("valid_sig", "rawbody");
      
      expect(dbMock.collection("users").updateOne).not.toHaveBeenCalled();
    });
  });
});
