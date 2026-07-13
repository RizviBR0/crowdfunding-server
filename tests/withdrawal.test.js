import request from "supertest";
import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";

import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import { signAccessToken } from "../src/services/token.service.js";

const getPathValue = (record, path) =>
  path.split(".").reduce((value, part) => (value == null ? value : value[part]), record);

const setPathValue = (record, path, value) => {
  const parts = path.split(".");
  let cursor = record;

  parts.slice(0, -1).forEach((part) => {
    cursor[part] ??= {};
    cursor = cursor[part];
  });

  cursor[parts.at(-1)] = value;
};

const matchesValue = (actual, expected) => {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if ("$ne" in expected) {
      return actual?.toString?.() !== expected.$ne?.toString?.();
    }

    if ("$in" in expected) {
      return expected.$in.some((value) => value?.toString?.() === actual?.toString?.());
    }
  }

  return actual?.toString?.() === expected?.toString?.();
};

const matchesFilter = (record, filter) =>
  Object.entries(filter).every(([key, value]) => matchesValue(getPathValue(record, key), value));

const applyUpdate = (record, update) => {
  Object.entries(update.$set ?? {}).forEach(([key, value]) => setPathValue(record, key, value));
  Object.entries(update.$inc ?? {}).forEach(([key, value]) => {
    setPathValue(record, key, (getPathValue(record, key) ?? 0) + value);
  });
};

const createFindCursor = (records) => {
  let workingRecords = [...records];

  return {
    sort(sortSpec) {
      const entries = Object.entries(sortSpec);

      workingRecords = [...workingRecords].sort((left, right) => {
        for (const [field, direction] of entries) {
          const leftValue = getPathValue(left, field) ?? 0;
          const rightValue = getPathValue(right, field) ?? 0;

          if (leftValue > rightValue) {
            return direction > 0 ? 1 : -1;
          }

          if (leftValue < rightValue) {
            return direction > 0 ? -1 : 1;
          }
        }

        return 0;
      });

      return this;
    },
    skip(count) {
      workingRecords = workingRecords.slice(count);
      return this;
    },
    limit(count) {
      workingRecords = workingRecords.slice(0, count);
      return this;
    },
    async toArray() {
      return workingRecords;
    },
  };
};

const createFakeDatabase = ({
  users = [],
  withdrawals = [],
  creditTransactions = [],
  notifications = [],
} = {}) => {
  const state = {
    users: structuredClone(users),
    withdrawals: structuredClone(withdrawals),
    creditTransactions: structuredClone(creditTransactions),
    notifications: structuredClone(notifications),
  };

  const collection = (name) => ({
    async findOne(filter) {
      const normalizedFilter = {};
      for (const [k, v] of Object.entries(filter)) {
        if (v instanceof ObjectId) {
          normalizedFilter[k] = v.toString();
        } else {
          normalizedFilter[k] = v;
        }
      }
      return state[name].find((record) => matchesFilter(record, normalizedFilter)) ?? null;
    },
    find(filter) {
      const normalizedFilter = {};
      for (const [k, v] of Object.entries(filter)) {
        if (v instanceof ObjectId) {
          normalizedFilter[k] = v.toString();
        } else {
          normalizedFilter[k] = v;
        }
      }
      return createFindCursor(state[name].filter((record) => matchesFilter(record, normalizedFilter)));
    },
    async countDocuments(filter) {
      const normalizedFilter = {};
      for (const [k, v] of Object.entries(filter)) {
        if (v instanceof ObjectId) {
          normalizedFilter[k] = v.toString();
        } else {
          normalizedFilter[k] = v;
        }
      }
      return state[name].filter((record) => matchesFilter(record, normalizedFilter)).length;
    },
    async insertOne(document) {
      const insertedId = new ObjectId().toString();
      state[name].push({ ...document, _id: insertedId });
      return { insertedId };
    },
    async updateOne(filter, update) {
      const normalizedFilter = {};
      for (const [k, v] of Object.entries(filter)) {
        if (v instanceof ObjectId) {
          normalizedFilter[k] = v.toString();
        } else {
          normalizedFilter[k] = v;
        }
      }
      const record = state[name].find((item) => matchesFilter(item, normalizedFilter));

      if (record) {
        applyUpdate(record, update);
      }

      return {
        matchedCount: record ? 1 : 0,
        modifiedCount: record ? 1 : 0,
      };
    },
  });

  return {
    state,
    collection,
    client: {
      startSession() {
        return {
          async withTransaction(operation) {
            return operation();
          },
          async endSession() {},
        };
      },
    },
  };
};

const baseConfig = () => ({
  ...parseEnv({ NODE_ENV: "test", ACCESS_TOKEN_SECRET: "test-access-token-secret" }),
  accessTokenExpiresIn: "1h",
});

const creatorUser = {
  _id: "users_creator",
  firebaseUid: "firebase-creator",
  displayName: "Chris Creator",
  email: "creator@example.com",
  photoUrl: "",
  role: "creator",
  credits: 20,
  creatorBalance: { lifetimeRaised: 600, reservedForWithdrawal: 0, withdrawn: 0 },
  status: "active",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

const adminUser = {
  _id: "users_admin",
  firebaseUid: "firebase-admin",
  displayName: "Alice Admin",
  email: "admin@example.com",
  photoUrl: "",
  role: "admin",
  credits: 0,
  status: "active",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

const supporterUser = {
  _id: "users_supporter",
  firebaseUid: "firebase-supporter",
  displayName: "Sam Supporter",
  email: "supporter@example.com",
  photoUrl: "",
  role: "supporter",
  credits: 100,
  status: "active",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

const createAccessToken = (user) =>
  signAccessToken({
    user: { id: user._id, email: user.email },
    config: baseConfig(),
  });

const createWithdrawalApp = (database) =>
  createApp({
    config: baseConfig(),
    databaseProvider: () => database,
  });

describe("withdrawal endpoints", () => {
  describe("GET /creator/earnings", () => {
    it("returns correct earnings information and blocks non-creator roles", async () => {
      const database = createFakeDatabase({
        users: [
          {
            ...creatorUser,
            creatorBalance: { lifetimeRaised: 500, reservedForWithdrawal: 100, withdrawn: 50 },
          },
          supporterUser,
        ],
      });
      const app = createWithdrawalApp(database);

      const response = await request(app)
        .get("/api/v1/creator/earnings")
        .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
        .expect(200);

      expect(response.body.data).toEqual({
        lifetimeRaised: 500,
        reservedForWithdrawal: 100,
        withdrawn: 50,
        withdrawable: 350,
        withdrawableAmountCents: 1750, // 350 * 5
      });

      await request(app)
        .get("/api/v1/creator/earnings")
        .set("Authorization", `Bearer ${createAccessToken(supporterUser)}`)
        .expect(403);
    });
  });

  describe("POST /withdrawals", () => {
    it("allows a creator to submit a withdrawal request, reserves balance, and logs in ledger", async () => {
      const database = createFakeDatabase({
        users: [creatorUser],
      });
      const app = createWithdrawalApp(database);

      const response = await request(app)
        .post("/api/v1/withdrawals")
        .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
        .set("Idempotency-Key", "req-key-12345")
        .send({
          credits: 300,
          paymentSystem: "Stripe",
          accountNumber: "US1234567890",
        })
        .expect(201);

      expect(response.body.data).toMatchObject({
        creatorId: "users_creator",
        withdrawalCredit: 300,
        withdrawalAmountCents: 1500,
        paymentSystem: "Stripe",
        accountNumberEncryptedOrMasked: "********7890",
        status: "pending",
        idempotencyKey: "req-key-12345",
      });

      // Verify DB updates
      const creatorInDb = database.state.users.find((u) => u._id === "users_creator");
      expect(creatorInDb.creatorBalance.reservedForWithdrawal).toBe(300);

      const ledgerEntry = database.state.creditTransactions.find((t) => t.type === "withdrawal_reserve");
      expect(ledgerEntry).toMatchObject({
        userId: "users_creator",
        amount: -300,
        balanceType: "creator_withdrawable",
        balanceAfter: 300, // 600 - 300
      });
    });

    it("enforces validation rules: minimum 200, positive, and check balance bounds", async () => {
      const database = createFakeDatabase({
        users: [creatorUser],
      });
      const app = createWithdrawalApp(database);

      // Under 200 limit
      await request(app)
        .post("/api/v1/withdrawals")
        .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
        .set("Idempotency-Key", "req-key-under-limit")
        .send({
          credits: 150,
          paymentSystem: "Bkash",
          accountNumber: "01712345678",
        })
        .expect(400);

      // Exceeds available balance (lifetimeRaised = 600)
      const exceedsResp = await request(app)
        .post("/api/v1/withdrawals")
        .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
        .set("Idempotency-Key", "req-key-exceeds")
        .send({
          credits: 700,
          paymentSystem: "Stripe",
          accountNumber: "US9999",
        })
        .expect(400);

      expect(exceedsResp.body.error.code).toBe("INSUFFICIENT_CREDITS");
    });

    it("handles idempotency replay and payload conflicts", async () => {
      const database = createFakeDatabase({
        users: [creatorUser],
      });
      const app = createWithdrawalApp(database);

      // First submit
      await request(app)
        .post("/api/v1/withdrawals")
        .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
        .set("Idempotency-Key", "req-key-idempotent")
        .send({
          credits: 200,
          paymentSystem: "Stripe",
          accountNumber: "US123",
        })
        .expect(201);

      // Replay identical payload
      const replayResp = await request(app)
        .post("/api/v1/withdrawals")
        .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
        .set("Idempotency-Key", "req-key-idempotent")
        .send({
          credits: 200,
          paymentSystem: "Stripe",
          accountNumber: "US123",
        })
        .expect(200);

      expect(replayResp.body.data.withdrawalCredit).toBe(200);

      // Replay conflict payload
      const conflictResp = await request(app)
        .post("/api/v1/withdrawals")
        .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
        .set("Idempotency-Key", "req-key-idempotent")
        .send({
          credits: 300,
          paymentSystem: "Bkash",
          accountNumber: "017",
        })
        .expect(409);

      expect(conflictResp.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    });
  });

  describe("PATCH /admin/withdrawals/:withdrawalId/approve", () => {
    it("allows admin to approve a withdrawal, consumes reservation, and notifies creator", async () => {
      const withdrawalFixture = {
        _id: "withdrawal_pending",
        creatorId: "users_creator",
        creatorEmail: "creator@example.com",
        creatorName: "Chris Creator",
        withdrawalCredit: 250,
        withdrawalAmountCents: 1250,
        paymentSystem: "Stripe",
        accountNumberEncryptedOrMasked: "******1234",
        status: "pending",
        idempotencyKey: "creator-request-key",
        withdrawDate: new Date(),
        processedAt: null,
        processedBy: null,
      };

      const database = createFakeDatabase({
        users: [
          {
            ...creatorUser,
            creatorBalance: { lifetimeRaised: 600, reservedForWithdrawal: 250, withdrawn: 50 },
          },
          adminUser,
        ],
        withdrawals: [withdrawalFixture],
      });
      const app = createWithdrawalApp(database);

      const response = await request(app)
        .patch("/api/v1/admin/withdrawals/withdrawal_pending/approve")
        .set("Authorization", `Bearer ${createAccessToken(adminUser)}`)
        .set("Idempotency-Key", "admin-decision-key")
        .expect(200);

      expect(response.body.data.status).toBe("approved");

      // Check DB updates
      const creatorInDb = database.state.users.find((u) => u._id === "users_creator");
      expect(creatorInDb.creatorBalance.reservedForWithdrawal).toBe(0);
      expect(creatorInDb.creatorBalance.withdrawn).toBe(300); // 50 + 250

      const ledgerEntry = database.state.creditTransactions.find((t) => t.type === "withdrawal_paid");
      expect(ledgerEntry).toMatchObject({
        userId: "users_creator",
        amount: -250,
        balanceType: "creator_withdrawable",
        balanceAfter: 300, // 600 - 300
      });

      const notification = database.state.notifications[0];
      expect(notification).toMatchObject({
        toUserId: "users_creator",
        toEmail: "creator@example.com",
        actionRoute: "/dashboard/creator/withdrawals",
        metadata: {
          decision: "approved",
          credits: 250,
        },
      });
    });

    it("supports admin decision idempotency and conflict block on decided requests", async () => {
      const withdrawalFixture = {
        _id: "withdrawal_decided",
        creatorId: "users_creator",
        creatorEmail: "creator@example.com",
        creatorName: "Chris Creator",
        withdrawalCredit: 250,
        withdrawalAmountCents: 1250,
        paymentSystem: "Stripe",
        accountNumberEncryptedOrMasked: "******1234",
        status: "approved",
        idempotencyKey: "creator-request-key",
        decisionIdempotencyKey: "admin-decision-key",
        withdrawDate: new Date(),
        processedAt: new Date(),
        processedBy: "users_admin",
      };

      const database = createFakeDatabase({
        users: [creatorUser, adminUser],
        withdrawals: [withdrawalFixture],
      });
      const app = createWithdrawalApp(database);

      // Replay same decision with same key
      const replay = await request(app)
        .patch("/api/v1/admin/withdrawals/withdrawal_decided/approve")
        .set("Authorization", `Bearer ${createAccessToken(adminUser)}`)
        .set("Idempotency-Key", "admin-decision-key")
        .expect(200);

      expect(replay.body.data.status).toBe("approved");

      // Send decision with different key
      const conflict = await request(app)
        .patch("/api/v1/admin/withdrawals/withdrawal_decided/approve")
        .set("Authorization", `Bearer ${createAccessToken(adminUser)}`)
        .set("Idempotency-Key", "another-decision-key")
        .expect(409);

      expect(conflict.body.error.code).toBe("WITHDRAWAL_DECISION_CONFLICT");
    });
  });

  describe("PATCH /admin/withdrawals/:withdrawalId/reject", () => {
    it("allows admin to reject a withdrawal, releases reserved balance, and logs in ledger", async () => {
      const withdrawalFixture = {
        _id: "withdrawal_pending",
        creatorId: "users_creator",
        creatorEmail: "creator@example.com",
        creatorName: "Chris Creator",
        withdrawalCredit: 250,
        withdrawalAmountCents: 1250,
        paymentSystem: "Stripe",
        accountNumberEncryptedOrMasked: "******1234",
        status: "pending",
        idempotencyKey: "creator-request-key",
        withdrawDate: new Date(),
        processedAt: null,
        processedBy: null,
      };

      const database = createFakeDatabase({
        users: [
          {
            ...creatorUser,
            creatorBalance: { lifetimeRaised: 600, reservedForWithdrawal: 250, withdrawn: 50 },
          },
          adminUser,
        ],
        withdrawals: [withdrawalFixture],
      });
      const app = createWithdrawalApp(database);

      const response = await request(app)
        .patch("/api/v1/admin/withdrawals/withdrawal_pending/reject")
        .set("Authorization", `Bearer ${createAccessToken(adminUser)}`)
        .set("Idempotency-Key", "admin-reject-key")
        .expect(200);

      expect(response.body.data.status).toBe("rejected");

      // Check DB updates
      const creatorInDb = database.state.users.find((u) => u._id === "users_creator");
      expect(creatorInDb.creatorBalance.reservedForWithdrawal).toBe(0);
      expect(creatorInDb.creatorBalance.withdrawn).toBe(50); // Unchanged

      const ledgerEntry = database.state.creditTransactions.find((t) => t.type === "withdrawal_release");
      expect(ledgerEntry).toMatchObject({
        userId: "users_creator",
        amount: 250,
        balanceType: "creator_withdrawable",
        balanceAfter: 550, // (600 - 0 - 50) = 550
      });

      const notification = database.state.notifications[0];
      expect(notification).toMatchObject({
        toUserId: "users_creator",
        toEmail: "creator@example.com",
        actionRoute: "/dashboard/creator/withdrawals",
        metadata: {
          decision: "rejected",
          credits: 250,
        },
      });
    });
  });
});
