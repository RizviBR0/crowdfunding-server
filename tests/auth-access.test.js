import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import { loadActiveUser, requireAdmin, requireSupporter, verifyAccessToken } from "../src/middleware/auth.js";
import { signAccessToken } from "../src/services/token.service.js";
import { sendSuccess } from "../src/utils/apiResponse.js";

const createFakeDatabase = ({ users = [] } = {}) => {
  const state = {
    users: [...users],
    creditTransactions: [],
  };

  const matchesFilter = (record, filter) =>
    Object.entries(filter).every(([key, value]) => record[key]?.toString?.() === value?.toString?.());

  const collection = (name) => ({
    async findOne(filter) {
      if (filter.$or) {
        return state[name].find((record) => filter.$or.some((condition) => matchesFilter(record, condition))) ?? null;
      }

      return state[name].find((record) => matchesFilter(record, filter)) ?? null;
    },
    async insertOne(document) {
      const insertedId = `users_${state.users.length + 1}`;
      state[name].push({ ...document, _id: insertedId });
      return { insertedId };
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

const baseConfig = () => ({
  ...parseEnv({ NODE_ENV: "test", ACCESS_TOKEN_SECRET: "test-access-token-secret" }),
  accessTokenExpiresIn: "1h",
});

const createAuthApp = ({ database, tokens = {}, configureRoutes } = {}) =>
  createApp({
    config: baseConfig(),
    databaseProvider: () => database,
    firebaseAuthProvider: () => createFakeFirebaseAuth(tokens),
    configureRoutes,
  });

describe("app access tokens and role guards", () => {
  it("returns an access token from session exchange and restores the current MongoDB user", async () => {
    const database = createFakeDatabase();
    const app = createAuthApp({
      database,
      tokens: {
        supporterToken: {
          uid: "firebase-supporter-2",
          email: "supporter2@example.com",
          name: "Sunny Supporter",
        },
      },
    });

    const sessionResponse = await request(app)
      .post("/api/v1/auth/session")
      .send({ firebaseIdToken: "supporterToken", intendedRole: "supporter" })
      .expect(201);

    expect(sessionResponse.body.data.accessToken).toEqual(expect.any(String));

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${sessionResponse.body.data.accessToken}`)
      .expect(200);

    expect(meResponse.body.data.user).toMatchObject({
      email: "supporter2@example.com",
      role: "supporter",
      credits: 50,
    });
  });

  it("rejects missing and malformed bearer tokens", async () => {
    const app = createAuthApp({ database: createFakeDatabase() });

    const missing = await request(app).get("/api/v1/auth/me").expect(401);
    expect(missing.body.error.code).toBe("AUTH_TOKEN_REQUIRED");

    const malformed = await request(app).get("/api/v1/auth/me").set("Authorization", "Token abc").expect(401);
    expect(malformed.body.error.code).toBe("INVALID_AUTH_HEADER");
  });

  it("rejects inactive users even when the token signature is valid", async () => {
    const database = createFakeDatabase({
      users: [
        {
          _id: "users_1",
          firebaseUid: "firebase-disabled-1",
          displayName: "Disabled User",
          email: "disabled@example.com",
          photoUrl: "",
          role: "supporter",
          credits: 50,
          creatorBalance: { lifetimeRaised: 0, reservedForWithdrawal: 0, withdrawn: 0 },
          status: "disabled",
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          updatedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      ],
    });
    const app = createAuthApp({ database });
    const accessToken = signAccessToken({
      user: { id: "users_1", email: "disabled@example.com" },
      config: baseConfig(),
    });

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(401);

    expect(response.body.error.code).toBe("USER_NOT_ACTIVE");
  });

  it("allows matching roles and blocks wrong roles with 403", async () => {
    const database = createFakeDatabase({
      users: [
        {
          _id: "users_1",
          firebaseUid: "firebase-supporter-3",
          displayName: "Role Supporter",
          email: "role-supporter@example.com",
          photoUrl: "",
          role: "supporter",
          credits: 50,
          creatorBalance: { lifetimeRaised: 0, reservedForWithdrawal: 0, withdrawn: 0 },
          status: "active",
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          updatedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      ],
    });
    const app = createAuthApp({
      database,
      tokens: {
        roleToken: {
          uid: "firebase-supporter-3",
          email: "role-supporter@example.com",
        },
      },
      configureRoutes(application) {
        application.get("/api/v1/test-supporter", verifyAccessToken, loadActiveUser, requireSupporter, (request, response) => {
          sendSuccess(response, 200, { ok: true });
        });
        application.get("/api/v1/test-admin", verifyAccessToken, loadActiveUser, requireAdmin, (request, response) => {
          sendSuccess(response, 200, { ok: true });
        });
      },
    });

    const sessionResponse = await request(app)
      .post("/api/v1/auth/session")
      .send({ firebaseIdToken: "roleToken", intendedRole: "supporter" })
      .expect(200);
    const token = sessionResponse.body.data.accessToken;

    await request(app).get("/api/v1/test-supporter").set("Authorization", `Bearer ${token}`).expect(200);
    const denied = await request(app).get("/api/v1/test-admin").set("Authorization", `Bearer ${token}`).expect(403);

    expect(denied.body.error.code).toBe("ROLE_FORBIDDEN");
  });
});
