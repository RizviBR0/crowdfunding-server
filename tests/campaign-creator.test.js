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

const createFakeDatabase = ({ users = [], campaigns = [], contributions = [], creditTransactions = [] } = {}) => {
  const state = {
    users: [...users],
    campaigns: [...campaigns],
    contributions: [...contributions],
    creditTransactions: [...creditTransactions],
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

const validCampaignBody = () => ({
  title: "Build a STEM Lab",
  story: "We are creating a hands-on lab where students can learn robotics and design.",
  category: "Education",
  fundingGoal: 18000,
  minimumContribution: 25,
  deadline: "2027-08-20T00:00:00.000Z",
  rewardInfo: "Supporters receive progress updates and a thank-you wall mention.",
  imageUrl: "https://example.com/stem-lab.jpg",
});

describe("creator campaign management", () => {
  it("creates pending campaigns with server-owned creator identity", async () => {
    const database = createFakeDatabase({ users: [creatorUser] });
    const app = createCampaignApp(database);

    const response = await request(app)
      .post("/api/v1/campaigns")
      .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
      .send(validCampaignBody())
      .expect(201);

    expect(response.body.data.campaign).toMatchObject({
      title: "Build a STEM Lab",
      creatorName: "Chris Creator",
      creatorEmail: "creator@example.com",
      amountRaised: 0,
      status: "pending",
    });
    expect(database.state.campaigns[0]).toMatchObject({
      creatorId: "users_creator",
      status: "pending",
    });
  });

  it("blocks non-creators from creating campaigns", async () => {
    const database = createFakeDatabase({ users: [supporterUser] });
    const app = createCampaignApp(database);

    const response = await request(app)
      .post("/api/v1/campaigns")
      .set("Authorization", `Bearer ${createAccessToken(supporterUser)}`)
      .send(validCampaignBody())
      .expect(403);

    expect(response.body.error.code).toBe("ROLE_FORBIDDEN");
    expect(database.state.campaigns).toHaveLength(0);
  });

  it("lists only the creator's non-deleted campaigns by deadline descending", async () => {
    const database = createFakeDatabase({
      users: [creatorUser],
      campaigns: [
        { _id: "campaign_old", title: "Old", creatorId: "users_creator", status: "pending", deadline: new Date("2027-01-01T00:00:00.000Z"), createdAt: new Date("2026-07-01T00:00:00.000Z") },
        { _id: "campaign_new", title: "New", creatorId: "users_creator", status: "approved", deadline: new Date("2027-09-01T00:00:00.000Z"), createdAt: new Date("2026-07-02T00:00:00.000Z") },
        { _id: "campaign_deleted", title: "Deleted", creatorId: "users_creator", status: "deleted", deadline: new Date("2028-01-01T00:00:00.000Z"), createdAt: new Date("2026-07-03T00:00:00.000Z") },
        { _id: "campaign_other", title: "Other", creatorId: "users_other", status: "approved", deadline: new Date("2029-01-01T00:00:00.000Z"), createdAt: new Date("2026-07-04T00:00:00.000Z") },
      ],
    });
    const app = createCampaignApp(database);

    const response = await request(app)
      .get("/api/v1/creator/campaigns")
      .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
      .expect(200);

    expect(response.body.data.campaigns.map((campaign) => campaign.title)).toEqual(["New", "Old"]);
    expect(response.body.meta).toMatchObject({
      page: 1,
      limit: 10,
      totalItems: 2,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  });

  it("updates only allowed owner fields while preserving campaign status", async () => {
    const database = createFakeDatabase({
      users: [creatorUser],
      campaigns: [
        {
          _id: "campaign_1",
          title: "Original Title",
          story: "Original story that is long enough to be valid for the campaign update.",
          rewardInfo: "Original reward",
          creatorId: "users_creator",
          status: "approved",
          deadline: new Date("2027-09-01T00:00:00.000Z"),
        },
      ],
    });
    const app = createCampaignApp(database);

    const response = await request(app)
      .patch("/api/v1/campaigns/campaign_1")
      .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
      .send({
        title: "Updated Title",
        story: "Updated campaign story that still keeps the original approved campaign visible.",
        rewardInfo: "Updated reward details",
      })
      .expect(200);

    expect(response.body.data.campaign).toMatchObject({
      title: "Updated Title",
      status: "approved",
    });
    expect(database.state.campaigns[0]).toMatchObject({
      title: "Updated Title",
      status: "approved",
    });

    const invalid = await request(app)
      .patch("/api/v1/campaigns/campaign_1")
      .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
      .send({ fundingGoal: 99999 })
      .expect(400);

    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("soft-deletes an owned campaign and refunds eligible contributions exactly once", async () => {
    const database = createFakeDatabase({
      users: [creatorUser, supporterUser],
      campaigns: [
        {
          _id: "campaign_1",
          title: "Approved Project",
          creatorId: "users_creator",
          creatorName: "Chris Creator",
          creatorEmail: "creator@example.com",
          status: "approved",
          amountRaised: 125,
          deadline: new Date("2027-09-01T00:00:00.000Z"),
        },
      ],
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
      .delete("/api/v1/campaigns/campaign_1")
      .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
      .expect(200);

    expect(response.body.data.refund).toEqual({
      refundedContributions: 2,
      refundedCredits: 125,
    });
    expect(database.state.campaigns[0].status).toBe("deleted");
    expect(database.state.campaigns[0].deletedAt).toEqual(expect.any(Date));
    expect(database.state.contributions.map((contribution) => contribution.status)).toEqual([
      "refunded",
      "refunded",
      "rejected",
    ]);
    expect(database.state.users.find((user) => user._id === "users_supporter").credits).toBe(225);
    expect(database.state.users.find((user) => user._id === "users_creator").creatorBalance.lifetimeRaised).toBe(375);
    expect(database.state.creditTransactions).toHaveLength(2);
    expect(database.state.creditTransactions[0]).toMatchObject({
      type: "campaign_delete_refund",
      amount: 75,
      balanceType: "credits",
      idempotencyKey: "campaign-delete:campaign_1:contribution_1",
    });

    const replay = await request(app)
      .delete("/api/v1/campaigns/campaign_1")
      .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
      .expect(409);

    expect(replay.body.error.code).toBe("CAMPAIGN_ALREADY_DELETED");
    expect(database.state.creditTransactions).toHaveLength(2);
  });
});
