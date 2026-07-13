import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { signAccessToken } from "../services/token.service.js";

const mockCreateCheckoutSession = vi.fn();
const mockHandleStripeWebhook = vi.fn();

const mockGetPaymentHistory = vi.fn();

vi.mock("../services/paymentService.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createCheckoutSession: (...args) => mockCreateCheckoutSession(...args),
    handleStripeWebhook: (...args) => mockHandleStripeWebhook(...args),
    getPaymentHistory: (...args) => mockGetPaymentHistory(...args),
  };
});

describe("paymentRoutes", () => {
  let app;
  const mockConfig = {
    apiPrefix: "/api/v1",
    corsOrigins: "http://localhost:5173",
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
    accessTokenSecret: "test_secret_for_jwt_which_needs_to_be_long_enough",
    accessTokenExpiresIn: "1h",
  };

  const mockDbStatus = vi.fn(() => ({ state: "connected" }));
  
  const mockFindOne = vi.fn();
  const mockCollection = vi.fn(() => ({
    findOne: mockFindOne,
  }));
  const mockDbProvider = vi.fn(() => ({
    collection: mockCollection,
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp({
      config: mockConfig,
      databaseStatusProvider: mockDbStatus,
      databaseProvider: mockDbProvider,
    });
  });

  describe("POST /api/v1/payments/checkout-session", () => {
    it("returns 401 if unauthorized", async () => {
      const response = await request(app).post("/api/v1/payments/checkout-session").send({ packageId: "package_100" });
      expect(response.status).toBe(401);
    });

    it("returns 403 if user is not a supporter", async () => {
      const token = signAccessToken({ user: { id: "user_1", email: "test@test.com" }, config: mockConfig });
      mockFindOne.mockResolvedValueOnce({ _id: "user_1", status: "active", role: "creator" });

      const response = await request(app)
        .post("/api/v1/payments/checkout-session")
        .set("Authorization", `Bearer ${token}`)
        .send({ packageId: "package_100" });
      
      expect(response.status).toBe(403);
    });

    it("returns 200 with checkout URL when successfully authorized", async () => {
      const token = signAccessToken({ user: { id: "user_1", email: "test@test.com" }, config: mockConfig });
      mockFindOne.mockResolvedValueOnce({ _id: "user_1", status: "active", role: "supporter", uid: "user_1" });
      
      mockCreateCheckoutSession.mockResolvedValueOnce({
        sessionId: "cs_test_123",
        checkoutUrl: "https://checkout.url",
      });

      const response = await request(app)
        .post("/api/v1/payments/checkout-session")
        .set("Authorization", `Bearer ${token}`)
        .send({ packageId: "package_100" });
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        sessionId: "cs_test_123",
        checkoutUrl: "https://checkout.url",
      });
      expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: "user_1" }),
        "package_100"
      );
    });
  });

  describe("POST /api/v1/payments/stripe/webhook", () => {
    it("handles valid webhooks and rawBody parsing", async () => {
      mockHandleStripeWebhook.mockResolvedValueOnce({ received: true });

      const response = await request(app)
        .post("/api/v1/payments/stripe/webhook")
        .set("stripe-signature", "sig_123")
        .set("content-type", "application/json") // Trigger express.json which uses verify to get rawBody
        .send({ type: "checkout.session.completed", id: "evt_123" });
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
      expect(mockHandleStripeWebhook).toHaveBeenCalledWith("sig_123", JSON.stringify({ type: "checkout.session.completed", id: "evt_123" }));
    });
  });

  describe("GET /api/v1/payments/history", () => {
    it("returns 401 if unauthorized", async () => {
      const response = await request(app).get("/api/v1/payments/history");
      expect(response.status).toBe(401);
    });

    it("returns 200 with payment history for a supporter", async () => {
      const token = signAccessToken({ user: { id: "user_1", email: "test@test.com" }, config: mockConfig });
      mockFindOne.mockResolvedValueOnce({ _id: "user_1", status: "active", role: "supporter", uid: "user_1" });
      
      mockGetPaymentHistory.mockResolvedValueOnce({
        payments: [{ _id: "pay_1", credits: 100 }],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });

      const response = await request(app)
        .get("/api/v1/payments/history?page=1&limit=10")
        .set("Authorization", `Bearer ${token}`);
      
      expect(response.status).toBe(200);
      expect(response.body.data.payments).toHaveLength(1);
      expect(response.body.meta.total).toBe(1);
      expect(mockGetPaymentHistory).toHaveBeenCalledWith("user_1", 1, 10);
    });
  });
});
