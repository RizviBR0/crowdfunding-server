import request from "supertest";
import { describe, expect, it } from "vitest";

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
  if (expected instanceof RegExp) {
    return expected.test(actual ?? "");
  }

  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if ("$ne" in expected) {
      return actual !== expected.$ne;
    }

    if ("$in" in expected) {
      return expected.$in.includes(actual);
    }
  }

  return actual?.toString?.() === expected?.toString?.();
};

const matchesFilter = (record, filter) => {
  if (filter.$or && !filter.$or.some((condition) => matchesFilter(record, condition))) {
    return false;
  }

  return Object.entries(filter)
    .filter(([key]) => key !== "$or")
    .every(([key, value]) => matchesValue(getPathValue(record, key), value));
};

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
  campaigns = [],
  contributions = [],
  creditTransactions = [],
  notifications = [],
} = {}) => {
  const state = {
    users: [...users],
    campaigns: [...campaigns],
    contributions: [...contributions],
    creditTransactions: [...creditTransactions],
    notifications: [...notifications],
  };

  const collection = (name) => ({
    async findOne(filter) {
      return state[name].find((record) => matchesFilter(record, filter)) ?? null;
    },
    find(filter) {
      return createFindCursor(state[name].filter((record) => matchesFilter(record, filter)));
    },
    async countDocuments(filter) {
      return state[name].filter((record) => matchesFilter(record, filter)).length;
    },
    async insertOne(document) {
      const insertedId = `${name}_${state[name].length + 1}`;
      state[name].push({ ...document, _id: insertedId });
      return { insertedId };
    },
    async updateOne(filter, update) {
      const record = state[name].find((item) => matchesFilter(item, filter));

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
  };
};

const baseConfig = () => ({
  ...parseEnv({ NODE_ENV: "test", ACCESS_TOKEN_SECRET: "test-access-token-secret" }),
  accessTokenExpiresIn: "1h",
});

const adminUser = {
  _id: "users_admin",
  firebaseUid: "firebase-admin",
  displayName: "Ada Admin",
  email: "admin@example.com",
  photoUrl: "",
  role: "admin",
  credits: 0,
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
  creatorBalance: { lifetimeRaised: 500, reservedForWithdrawal: 0, withdrawn: 0 },
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

const createCampaignApp = (database) =>
  createApp({
    config: baseConfig(),
    databaseProvider: () => database,
  });

const campaignFixture = (overrides = {}) => ({
  _id: "campaign_1",
  title: "Community Robotics Lab",
  story: "A practical robotics lab for local students.",
  category: "Education",
  fundingGoal: 18000,
  minimumContribution: 25,
  deadline: new Date("2027-09-01T00:00:00.000Z"),
  rewardInfo: "Backers get progress updates.",
  imageUrl: "https://example.com/robotics.jpg",
  creatorId: "users_creator",
  creatorName: "Chris Creator",
  creatorEmail: "creator@example.com",
  amountRaised: 125,
  status: "pending",
  moderation: null,
  createdAt: new Date("2026-07-03T00:00:00.000Z"),
  updatedAt: new Date("2026-07-03T00:00:00.000Z"),
  deletedAt: null,
  ...overrides,
});

describe("admin campaign moderation", () => {
  it("lists pending campaigns for admins and blocks non-admin users", async () => {
    const database = createFakeDatabase({
      users: [adminUser, creatorUser],
      campaigns: [
        campaignFixture({ _id: "campaign_pending", title: "Pending Project", status: "pending" }),
        campaignFixture({ _id: "campaign_approved", title: "Approved Project", status: "approved" }),
      ],
    });
    const app = createCampaignApp(database);

    const response = await request(app)
      .get("/api/v1/admin/campaigns?status=pending")
      .set("Authorization", `Bearer ${createAccessToken(adminUser)}`)
      .expect(200);

    expect(response.body.data.campaigns.map((campaign) => campaign.title)).toEqual(["Pending Project"]);
    expect(response.body.meta).toMatchObject({
      page: 1,
      limit: 10,
      totalItems: 1,
      totalPages: 1,
    });

    const denied = await request(app)
      .get("/api/v1/admin/campaigns")
      .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
      .expect(403);

    expect(denied.body.error.code).toBe("ROLE_FORBIDDEN");
  });

  it("approves pending campaigns and notifies the creator transactionally", async () => {
    const database = createFakeDatabase({
      users: [adminUser],
      campaigns: [campaignFixture()],
    });
    const app = createCampaignApp(database);

    const response = await request(app)
      .patch("/api/v1/admin/campaigns/campaign_1/decision")
      .set("Authorization", `Bearer ${createAccessToken(adminUser)}`)
      .send({ decision: "approved", reason: "Meets platform guidelines." })
      .expect(200);

    expect(response.body.data.campaign).toMatchObject({
      id: "campaign_1",
      status: "approved",
      moderation: {
        action: "approved",
        decidedBy: "users_admin",
        reason: "Meets platform guidelines.",
      },
    });
    expect(database.state.campaigns[0].status).toBe("approved");
    expect(database.state.notifications).toHaveLength(1);
    expect(database.state.notifications[0]).toMatchObject({
      type: "campaign_decision",
      toEmail: "creator@example.com",
      actionRoute: "/dashboard/creator/campaigns",
      eventKey: "campaign-decision:campaign_1:approved",
    });
  });

  it("rejects decision changes for non-pending campaigns without sending notifications", async () => {
    const database = createFakeDatabase({
      users: [adminUser],
      campaigns: [campaignFixture({ status: "approved" })],
    });
    const app = createCampaignApp(database);

    const response = await request(app)
      .patch("/api/v1/admin/campaigns/campaign_1/decision")
      .set("Authorization", `Bearer ${createAccessToken(adminUser)}`)
      .send({ decision: "rejected" })
      .expect(409);

    expect(response.body.error.code).toBe("CAMPAIGN_DECISION_CONFLICT");
    expect(database.state.campaigns[0].status).toBe("approved");
    expect(database.state.notifications).toHaveLength(0);
  });

  it("suspends campaigns with admin moderation metadata and no automatic refunds", async () => {
    const database = createFakeDatabase({
      users: [adminUser, supporterUser],
      campaigns: [campaignFixture({ status: "approved" })],
      contributions: [
        {
          _id: "contribution_1",
          campaignId: "campaign_1",
          supporterId: "users_supporter",
          amount: 75,
          status: "approved",
        },
      ],
    });
    const app = createCampaignApp(database);

    const response = await request(app)
      .patch("/api/v1/admin/campaigns/campaign_1/suspend")
      .set("Authorization", `Bearer ${createAccessToken(adminUser)}`)
      .send({ reason: "Suspicious report is under review." })
      .expect(200);

    expect(response.body.data.campaign).toMatchObject({
      status: "suspended",
      moderation: {
        action: "suspended",
        decidedBy: "users_admin",
        reason: "Suspicious report is under review.",
      },
    });
    expect(database.state.contributions[0].status).toBe("approved");
    expect(database.state.users.find((user) => user._id === "users_supporter").credits).toBe(100);
    expect(database.state.creditTransactions).toHaveLength(0);
  });

  it("soft-deletes campaigns with eligible refunds and admin moderation metadata", async () => {
    const database = createFakeDatabase({
      users: [adminUser, creatorUser, supporterUser],
      campaigns: [campaignFixture({ status: "approved" })],
      contributions: [
        {
          _id: "contribution_1",
          campaignId: "campaign_1",
          supporterId: "users_supporter",
          amount: 75,
          status: "approved",
        },
        {
          _id: "contribution_2",
          campaignId: "campaign_1",
          supporterId: "users_supporter",
          amount: 50,
          status: "pending",
        },
        {
          _id: "contribution_3",
          campaignId: "campaign_1",
          supporterId: "users_supporter",
          amount: 25,
          status: "rejected",
        },
      ],
    });
    const app = createCampaignApp(database);

    const response = await request(app)
      .delete("/api/v1/admin/campaigns/campaign_1")
      .set("Authorization", `Bearer ${createAccessToken(adminUser)}`)
      .send({ reason: "Confirmed fraudulent campaign." })
      .expect(200);

    expect(response.body.data.refund).toEqual({
      refundedContributions: 2,
      refundedCredits: 125,
    });
    expect(response.body.data.campaign).toMatchObject({
      status: "deleted",
      moderation: {
        action: "deleted",
        decidedBy: "users_admin",
        reason: "Confirmed fraudulent campaign.",
      },
    });
    expect(database.state.campaigns[0]).toMatchObject({
      status: "deleted",
      moderation: {
        action: "deleted",
        decidedBy: "users_admin",
      },
    });
    expect(database.state.contributions.map((contribution) => contribution.status)).toEqual([
      "refunded",
      "refunded",
      "rejected",
    ]);
    expect(database.state.users.find((user) => user._id === "users_supporter").credits).toBe(225);
    expect(database.state.users.find((user) => user._id === "users_creator").creatorBalance.lifetimeRaised).toBe(375);
    expect(database.state.creditTransactions).toHaveLength(2);

    const replay = await request(app)
      .delete("/api/v1/admin/campaigns/campaign_1")
      .set("Authorization", `Bearer ${createAccessToken(adminUser)}`)
      .send({ reason: "Confirmed fraudulent campaign." })
      .expect(409);

    expect(replay.body.error.code).toBe("CAMPAIGN_ALREADY_DELETED");
    expect(database.state.creditTransactions).toHaveLength(2);
  });
});
