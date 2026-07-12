import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";

const createFakeDatabase = ({ users = [] } = {}) => {
  const state = {
    users: [...users],
    creditTransactions: [],
  };

  const matchesFilter = (record, filter) => {
    if (filter.$or) {
      return filter.$or.some((condition) => matchesFilter(record, condition));
    }

    return Object.entries(filter).every(([key, value]) => record[key] === value);
  };

  const collection = (name) => ({
    async findOne(filter) {
      return state[name].find((record) => matchesFilter(record, filter)) ?? null;
    },
    async insertOne(document) {
      const insertedId = `${name}_${state[name].length + 1}`;
      state[name].push({ ...document, _id: insertedId });
      return { insertedId };
    },
    async updateOne(filter, update) {
      const record = state[name].find((item) => matchesFilter(item, filter));

      if (record && update.$set) {
        Object.assign(record, update.$set);
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
  };
};

const createFakeFirebaseAuth = (tokens) => ({
  async verifyIdToken(token) {
    const decodedToken = tokens[token];

    if (!decodedToken) {
      throw new Error("invalid token");
    }

    return decodedToken;
  },
});

const createAuthApp = ({ database, tokens, adminBootstrapEmails = [] }) =>
  createApp({
    config: {
      ...parseEnv({ NODE_ENV: "test" }),
      adminBootstrapEmails,
    },
    databaseProvider: () => database,
    firebaseAuthProvider: () => createFakeFirebaseAuth(tokens),
  });

describe("auth session exchange", () => {
  it("creates a first-time supporter with exactly one registration grant and ledger row", async () => {
    const database = createFakeDatabase();
    const app = createAuthApp({
      database,
      tokens: {
        supporterToken: {
          uid: "firebase-supporter-1",
          email: "SUPPORTER@Example.com",
          name: "Sam Supporter",
          picture: "https://example.com/sam.png",
        },
      },
    });

    const response = await request(app)
      .post("/api/v1/auth/session")
      .send({ firebaseIdToken: "supporterToken", intendedRole: "supporter" })
      .expect(201);

    expect(response.body.data.user).toMatchObject({
      firebaseUid: "firebase-supporter-1",
      displayName: "Sam Supporter",
      email: "supporter@example.com",
      role: "supporter",
      credits: 50,
      status: "active",
    });
    expect(database.state.users).toHaveLength(1);
    expect(database.state.creditTransactions).toHaveLength(1);
    expect(database.state.creditTransactions[0]).toMatchObject({
      type: "registration_grant",
      amount: 50,
      balanceType: "credits",
      idempotencyKey: "registration:firebase-supporter-1",
    });
  });

  it("requires a Supporter or Creator role intent for first-time non-admin sign-ins", async () => {
    const database = createFakeDatabase();
    const app = createAuthApp({
      database,
      tokens: {
        googleToken: {
          uid: "firebase-google-1",
          email: "new-google@example.com",
        },
      },
    });

    const response = await request(app)
      .post("/api/v1/auth/session")
      .send({ firebaseIdToken: "googleToken" })
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: "ROLE_REQUIRED",
    });
    expect(database.state.users).toHaveLength(0);
    expect(database.state.creditTransactions).toHaveLength(0);
  });

  it("bootstraps allow-listed admin emails without registration credits", async () => {
    const database = createFakeDatabase();
    const app = createAuthApp({
      database,
      adminBootstrapEmails: ["admin@example.com"],
      tokens: {
        adminToken: {
          uid: "firebase-admin-1",
          email: "Admin@Example.com",
          name: "Ada Admin",
        },
      },
    });

    const response = await request(app)
      .post("/api/v1/auth/session")
      .send({ firebaseIdToken: "adminToken" })
      .expect(201);

    expect(response.body.data.user).toMatchObject({
      email: "admin@example.com",
      role: "admin",
      credits: 0,
    });
    expect(database.state.creditTransactions).toHaveLength(0);
  });

  it("returns existing users without changing their role or issuing another grant", async () => {
    const existingCreatedAt = new Date("2026-07-01T00:00:00.000Z");
    const database = createFakeDatabase({
      users: [
        {
          _id: "users_1",
          firebaseUid: "firebase-creator-1",
          displayName: "Chris Creator",
          email: "creator@example.com",
          photoUrl: "",
          role: "creator",
          credits: 20,
          creatorBalance: { lifetimeRaised: 0, reservedForWithdrawal: 0, withdrawn: 0 },
          status: "active",
          initialCreditGrantKey: "registration:firebase-creator-1",
          createdAt: existingCreatedAt,
          updatedAt: existingCreatedAt,
        },
      ],
    });
    const app = createAuthApp({
      database,
      tokens: {
        creatorToken: {
          uid: "firebase-creator-1",
          email: "creator@example.com",
          name: "Changed Name",
        },
      },
    });

    const response = await request(app)
      .post("/api/v1/auth/session")
      .send({ firebaseIdToken: "creatorToken", intendedRole: "supporter" })
      .expect(200);

    expect(response.body.data.user).toMatchObject({
      email: "creator@example.com",
      role: "creator",
      credits: 20,
    });
    expect(database.state.users).toHaveLength(1);
    expect(database.state.creditTransactions).toHaveLength(0);
  });

  it("rejects invalid Firebase identity tokens", async () => {
    const database = createFakeDatabase();
    const app = createAuthApp({ database, tokens: {} });

    const response = await request(app)
      .post("/api/v1/auth/session")
      .send({ firebaseIdToken: "bad-token", intendedRole: "supporter" })
      .expect(401);

    expect(response.body.error).toMatchObject({
      code: "INVALID_FIREBASE_TOKEN",
    });
  });
});
