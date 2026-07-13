import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import { signAccessToken } from "../src/services/token.service.js";

const createFakeDatabase = ({
  users = [],
  contributions = [],
} = {}) => {
  const state = {
    users: structuredClone(users),
    contributions: structuredClone(contributions),
  };

  const collection = (name) => ({
    async findOne(filter) {
      return state[name]?.find((record) =>
        Object.entries(filter).every(([key, value]) => {
          const actual = record[key];

          if (value && typeof value === "object" && "$in" in value) {
            return value.$in.includes(actual);
          }

          return actual?.toString?.() === value?.toString?.();
        }),
      ) ?? null;
    },
    find(filter) {
      const matchedRecords = (state[name] ?? []).filter((record) =>
        Object.entries(filter).every(([key, value]) => {
          const actual = record[key];

          if (value && typeof value === "object" && "$in" in value) {
            return value.$in.includes(actual);
          }

          return actual?.toString?.() === value?.toString?.();
        }),
      );

      let sortFn = null;
      let skipN = 0;
      let limitN = Infinity;

      const cursor = {
        sort(fields) {
          const entries = Object.entries(fields);
          sortFn = (a, b) => {
            for (const [field, direction] of entries) {
              const aVal = a[field];
              const bVal = b[field];

              if (aVal < bVal) return -direction;
              if (aVal > bVal) return direction;
            }

            return 0;
          };

          return cursor;
        },
        skip(n) {
          skipN = n;
          return cursor;
        },
        limit(n) {
          limitN = n;
          return cursor;
        },
        async toArray() {
          let result = [...matchedRecords];

          if (sortFn) {
            result.sort(sortFn);
          }

          return result.slice(skipN, skipN + limitN);
        },
      };

      return cursor;
    },
    async countDocuments(filter) {
      return (state[name] ?? []).filter((record) =>
        Object.entries(filter).every(([key, value]) => {
          const actual = record[key];

          if (value && typeof value === "object" && "$in" in value) {
            return value.$in.includes(actual);
          }

          return actual?.toString?.() === value?.toString?.();
        }),
      ).length;
    },
    aggregate(pipeline) {
      let docs = [...(state[name] ?? [])];

      for (const stage of pipeline) {
        if (stage.$match) {
          docs = docs.filter((record) =>
            Object.entries(stage.$match).every(([key, value]) =>
              record[key]?.toString?.() === value?.toString?.(),
            ),
          );
        }

        if (stage.$group) {
          const grouped = {};
          const groupId = stage.$group._id;

          for (const doc of docs) {
            const key = groupId === null ? "__all__" : doc[groupId];

            if (!grouped[key]) {
              grouped[key] = { _id: groupId === null ? null : key };

              for (const [field, op] of Object.entries(stage.$group)) {
                if (field === "_id") continue;

                if (op.$sum === 1) {
                  grouped[key][field] = 0;
                } else if (typeof op.$sum === "string" && op.$sum.startsWith("$")) {
                  grouped[key][field] = 0;
                } else if (op.$sum && op.$sum.$cond) {
                  grouped[key][field] = 0;
                }
              }
            }

            for (const [field, op] of Object.entries(stage.$group)) {
              if (field === "_id") continue;

              if (op.$sum === 1) {
                grouped[key][field] += 1;
              } else if (typeof op.$sum === "string" && op.$sum.startsWith("$")) {
                grouped[key][field] += doc[op.$sum.slice(1)] ?? 0;
              } else if (op.$sum && op.$sum.$cond) {
                const [condition, thenVal, elseVal] = op.$sum.$cond;
                let matches = false;

                if (condition.$eq) {
                  const [condField, condValue] = condition.$eq;
                  matches = doc[condField.slice(1)]?.toString?.() === condValue?.toString?.();
                }

                const value = matches
                  ? (typeof thenVal === "string" && thenVal.startsWith("$") ? doc[thenVal.slice(1)] ?? 0 : thenVal)
                  : elseVal;

                grouped[key][field] += value;
              }
            }
          }

          docs = Object.values(grouped);
        }

        if (stage.$project) {
          const isExclusionOnly = Object.values(stage.$project).every((v) => v === 0 || v === false);

          docs = docs.map((doc) => {
            const result = isExclusionOnly ? { ...doc } : {};

            for (const [field, include] of Object.entries(stage.$project)) {
              if (include === 0 || include === false) {
                delete result[field];
              } else if (include === 1 || include === true) {
                result[field] = doc[field];
              }
            }

            return result;
          });
        }
      }

      return {
        async toArray() {
          return docs;
        },
      };
    },
  });

  return { state, collection };
};

const baseConfig = () => ({
  ...parseEnv({ NODE_ENV: "test", ACCESS_TOKEN_SECRET: "test-access-token-secret" }),
  accessTokenExpiresIn: "1h",
});

const supporterUser = {
  _id: "users_supporter",
  firebaseUid: "firebase-supporter",
  displayName: "Sam Supporter",
  email: "supporter@example.com",
  photoUrl: "",
  role: "supporter",
  credits: 200,
  creatorBalance: { lifetimeRaised: 0, reservedForWithdrawal: 0, withdrawn: 0 },
  status: "active",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

const creatorUser = {
  _id: "users_creator",
  firebaseUid: "firebase-creator",
  displayName: "Chris Creator",
  email: "creator@example.com",
  photoUrl: "",
  role: "creator",
  credits: 20,
  creatorBalance: { lifetimeRaised: 0, reservedForWithdrawal: 0, withdrawn: 0 },
  status: "active",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

const createAccessToken = (user) =>
  signAccessToken({
    user: { id: user._id, email: user.email },
    config: baseConfig(),
  });

const contributionFixture = (overrides = {}) => ({
  _id: `contrib_${overrides._id ?? "1"}`,
  campaignId: "campaign_1",
  campaignTitle: "Community Robotics Lab",
  amount: 50,
  supporterId: "users_supporter",
  supporterEmail: "supporter@example.com",
  supporterName: "Sam Supporter",
  creatorId: "users_creator",
  creatorEmail: "creator@example.com",
  creatorName: "Chris Creator",
  message: "",
  status: "pending",
  idempotencyKey: `key-${overrides._id ?? "1"}`,
  createdAt: new Date("2026-07-05T00:00:00.000Z"),
  decidedAt: null,
  decidedBy: null,
  refundedAt: null,
  ...overrides,
});

const createTestApp = ({ users, contributions } = {}) => {
  const config = baseConfig();
  const fakeDb = createFakeDatabase({
    users: users ?? [supporterUser, creatorUser],
    contributions: contributions ?? [],
  });

  return createApp({
    config,
    databaseStatusProvider: () => ({ status: "connected", lastError: null }),
    databaseProvider: () => fakeDb,
  });
};

describe("Supporter contribution endpoints", () => {
  describe("GET /api/v1/supporter/contributions/stats", () => {
    it("returns zeroed stats when supporter has no contributions", async () => {
      const app = createTestApp();
      const token = createAccessToken(supporterUser);

      const response = await request(app)
        .get("/api/v1/supporter/contributions/stats")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.stats.totalContributions).toBe(0);
      expect(response.body.data.stats.pendingContributions).toBe(0);
      expect(response.body.data.stats.totalApprovedAmount).toBe(0);
    });

    it("aggregates correct stats from mixed contribution statuses", async () => {
      const contributions = [
        contributionFixture({ _id: "1", status: "pending", amount: 30 }),
        contributionFixture({ _id: "2", status: "approved", amount: 50, decidedAt: new Date() }),
        contributionFixture({ _id: "3", status: "approved", amount: 75, decidedAt: new Date() }),
        contributionFixture({ _id: "4", status: "rejected", amount: 25 }),
        contributionFixture({ _id: "5", status: "pending", amount: 20 }),
      ];

      const app = createTestApp({ contributions });
      const token = createAccessToken(supporterUser);

      const response = await request(app)
        .get("/api/v1/supporter/contributions/stats")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.stats.totalContributions).toBe(5);
      expect(response.body.data.stats.pendingContributions).toBe(2);
      expect(response.body.data.stats.totalApprovedAmount).toBe(125);
    });

    it("rejects creator role access", async () => {
      const app = createTestApp();
      const token = createAccessToken(creatorUser);

      const response = await request(app)
        .get("/api/v1/supporter/contributions/stats")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/v1/supporter/contributions/approved", () => {
    it("returns only approved contributions for the supporter", async () => {
      const contributions = [
        contributionFixture({ _id: "1", status: "approved", amount: 50, decidedAt: new Date("2026-07-06") }),
        contributionFixture({ _id: "2", status: "pending", amount: 30 }),
        contributionFixture({ _id: "3", status: "approved", amount: 75, decidedAt: new Date("2026-07-07") }),
      ];

      const app = createTestApp({ contributions });
      const token = createAccessToken(supporterUser);

      const response = await request(app)
        .get("/api/v1/supporter/contributions/approved")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.contributions).toHaveLength(2);
      expect(response.body.data.contributions.every((c) => c.status === "approved")).toBe(true);
    });

    it("returns pagination metadata", async () => {
      const contributions = Array.from({ length: 15 }, (_, i) =>
        contributionFixture({
          _id: String(i + 1),
          status: "approved",
          amount: 10 + i,
          decidedAt: new Date(`2026-07-${String(i + 1).padStart(2, "0")}`),
        }),
      );

      const app = createTestApp({ contributions });
      const token = createAccessToken(supporterUser);

      const response = await request(app)
        .get("/api/v1/supporter/contributions/approved?page=2&limit=5")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.contributions).toHaveLength(5);
      expect(response.body.meta.page).toBe(2);
      expect(response.body.meta.totalItems).toBe(15);
      expect(response.body.meta.totalPages).toBe(3);
      expect(response.body.meta.hasNext).toBe(true);
      expect(response.body.meta.hasPrev).toBe(true);
    });
  });

  describe("GET /api/v1/supporter/contributions", () => {
    it("returns all contributions for the supporter newest-first", async () => {
      const contributions = [
        contributionFixture({ _id: "1", status: "pending", createdAt: new Date("2026-07-05") }),
        contributionFixture({ _id: "2", status: "approved", createdAt: new Date("2026-07-07") }),
        contributionFixture({ _id: "3", status: "rejected", createdAt: new Date("2026-07-06") }),
      ];

      const app = createTestApp({ contributions });
      const token = createAccessToken(supporterUser);

      const response = await request(app)
        .get("/api/v1/supporter/contributions")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.contributions).toHaveLength(3);

      const dates = response.body.data.contributions.map((c) => new Date(c.createdAt).getTime());
      expect(dates[0]).toBeGreaterThanOrEqual(dates[1]);
      expect(dates[1]).toBeGreaterThanOrEqual(dates[2]);
    });

    it("filters by status when provided", async () => {
      const contributions = [
        contributionFixture({ _id: "1", status: "pending" }),
        contributionFixture({ _id: "2", status: "approved" }),
        contributionFixture({ _id: "3", status: "rejected" }),
      ];

      const app = createTestApp({ contributions });
      const token = createAccessToken(supporterUser);

      const response = await request(app)
        .get("/api/v1/supporter/contributions?status=pending")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.contributions).toHaveLength(1);
      expect(response.body.data.contributions[0].status).toBe("pending");
    });

    it("returns paginated results with metadata", async () => {
      const contributions = Array.from({ length: 12 }, (_, i) =>
        contributionFixture({
          _id: String(i + 1),
          status: i % 2 === 0 ? "approved" : "pending",
          createdAt: new Date(`2026-07-${String(i + 1).padStart(2, "0")}`),
        }),
      );

      const app = createTestApp({ contributions });
      const token = createAccessToken(supporterUser);

      const response = await request(app)
        .get("/api/v1/supporter/contributions?page=1&limit=5")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.contributions).toHaveLength(5);
      expect(response.body.meta.page).toBe(1);
      expect(response.body.meta.totalItems).toBe(12);
      expect(response.body.meta.totalPages).toBe(3);
      expect(response.body.meta.hasNext).toBe(true);
      expect(response.body.meta.hasPrev).toBe(false);
    });

    it("rejects unauthenticated request", async () => {
      const app = createTestApp();

      const response = await request(app)
        .get("/api/v1/supporter/contributions");

      expect(response.status).toBe(401);
    });
  });
});
