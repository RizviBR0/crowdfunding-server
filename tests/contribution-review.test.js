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
  campaigns = [],
  contributions = [],
  creditTransactions = [],
  notifications = [],
} = {}) => {
  const state = {
    users: structuredClone(users),
    campaigns: structuredClone(campaigns),
    contributions: structuredClone(contributions),
    creditTransactions: structuredClone(creditTransactions),
    notifications: structuredClone(notifications),
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
  creatorBalance: { lifetimeRaised: 125, reservedForWithdrawal: 0, withdrawn: 0 },
  status: "active",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

const otherCreatorUser = {
  ...creatorUser,
  _id: "users_other_creator",
  firebaseUid: "firebase-other-creator",
  displayName: "Olivia Owner",
  email: "other.creator@example.com",
};

const supporterUser = {
  _id: "users_supporter",
  firebaseUid: "firebase-supporter",
  displayName: "Sam Supporter",
  email: "supporter@example.com",
  photoUrl: "",
  role: "supporter",
  credits: 125,
  creatorBalance: { lifetimeRaised: 0, reservedForWithdrawal: 0, withdrawn: 0 },
  status: "active",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

const campaignFixture = (overrides = {}) => ({
  _id: "campaign_1",
  title: "Community Robotics Lab",
  story: "A practical robotics lab for local students.",
  category: "Education",
  fundingGoal: 500,
  minimumContribution: 25,
  deadline: new Date("2027-09-01T00:00:00.000Z"),
  rewardInfo: "Backers get progress updates.",
  imageUrl: "https://example.com/robotics.jpg",
  creatorId: "users_creator",
  creatorName: "Chris Creator",
  creatorEmail: "creator@example.com",
  amountRaised: 125,
  status: "approved",
  moderation: null,
  createdAt: new Date("2026-07-03T00:00:00.000Z"),
  updatedAt: new Date("2026-07-03T00:00:00.000Z"),
  deletedAt: null,
  ...overrides,
});

const contributionFixture = (overrides = {}) => ({
  _id: "contribution_1",
  campaignId: "campaign_1",
  campaignTitle: "Community Robotics Lab",
  amount: 75,
  supporterId: "users_supporter",
  supporterEmail: "supporter@example.com",
  supporterName: "Sam Supporter",
  creatorId: "users_creator",
  creatorEmail: "creator@example.com",
  creatorName: "Chris Creator",
  message: "Please build the sensor kit too.",
  status: "pending",
  idempotencyKey: "create-key-1",
  decisionIdempotencyKey: null,
  createdAt: new Date("2026-07-10T00:00:00.000Z"),
  decidedAt: null,
  decidedBy: null,
  refundedAt: null,
  ...overrides,
});

const createAccessToken = (user) =>
  signAccessToken({
    user: { id: user._id, email: user.email },
    config: baseConfig(),
  });

const createContributionApp = (database) =>
  createApp({
    config: baseConfig(),
    databaseProvider: () => database,
  });

const patchDecision = ({ app, user = creatorUser, contributionId = "contribution_1", key = "decision-key-1", decision }) =>
  request(app)
    .patch(`/api/v1/creator/contributions/${contributionId}/decision`)
    .set("Authorization", `Bearer ${createAccessToken(user)}`)
    .set("Idempotency-Key", key)
    .send({ decision });

describe("creator contribution review", () => {
  it("lists only the creator's pending contributions and blocks non-creator users", async () => {
    const database = createFakeDatabase({
      users: [creatorUser, supporterUser],
      contributions: [
        contributionFixture({ _id: "contribution_newer", createdAt: new Date("2026-07-11T00:00:00.000Z") }),
        contributionFixture({ _id: "contribution_approved", status: "approved" }),
        contributionFixture({ _id: "contribution_other", creatorId: "users_other_creator" }),
      ],
    });
    const app = createContributionApp(database);

    const response = await request(app)
      .get("/api/v1/creator/contributions/pending")
      .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
      .expect(200);

    expect(response.body.data.contributions).toHaveLength(1);
    expect(response.body.data.contributions[0]).toMatchObject({
      id: "contribution_newer",
      supporterName: "Sam Supporter",
      campaignTitle: "Community Robotics Lab",
      amount: 75,
      status: "pending",
    });
    expect(response.body.meta).toMatchObject({
      page: 1,
      limit: 10,
      totalItems: 1,
      totalPages: 1,
    });

    const denied = await request(app)
      .get("/api/v1/creator/contributions/pending")
      .set("Authorization", `Bearer ${createAccessToken(supporterUser)}`)
      .expect(403);

    expect(denied.body.error.code).toBe("ROLE_FORBIDDEN");
  });

  it("returns owner-scoped contribution detail with the supporter message", async () => {
    const database = createFakeDatabase({
      users: [creatorUser, otherCreatorUser],
      contributions: [contributionFixture()],
    });
    const app = createContributionApp(database);

    const response = await request(app)
      .get("/api/v1/creator/contributions/contribution_1")
      .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
      .expect(200);

    expect(response.body.data.contribution).toMatchObject({
      id: "contribution_1",
      message: "Please build the sensor kit too.",
      supporterEmail: "supporter@example.com",
    });

    const hidden = await request(app)
      .get("/api/v1/creator/contributions/contribution_1")
      .set("Authorization", `Bearer ${createAccessToken(otherCreatorUser)}`)
      .expect(404);

    expect(hidden.body.error.code).toBe("CONTRIBUTION_NOT_FOUND");
  });

  it("approves a pending contribution once and records campaign, creator, ledger, and notification updates", async () => {
    const database = createFakeDatabase({
      users: [creatorUser, supporterUser],
      campaigns: [campaignFixture()],
      contributions: [contributionFixture()],
    });
    const app = createContributionApp(database);

    const response = await patchDecision({ app, decision: "approved" }).expect(200);

    expect(response.body.data.contribution).toMatchObject({
      id: "contribution_1",
      status: "approved",
      decidedBy: "users_creator",
    });
    expect(database.state.contributions[0]).toMatchObject({
      status: "approved",
      decisionIdempotencyKey: "decision-key-1",
      decidedBy: "users_creator",
    });
    expect(database.state.campaigns[0].amountRaised).toBe(200);
    expect(database.state.users.find((user) => user._id === "users_creator").creatorBalance.lifetimeRaised).toBe(200);
    expect(database.state.users.find((user) => user._id === "users_supporter").credits).toBe(125);
    expect(database.state.creditTransactions[0]).toMatchObject({
      type: "creator_raise",
      amount: 75,
      balanceType: "creator_withdrawable",
      balanceAfter: 200,
      idempotencyKey: "contribution-approval:contribution_1:decision-key-1",
    });
    expect(database.state.notifications[0]).toMatchObject({
      type: "contribution_decision",
      toEmail: "supporter@example.com",
      actionRoute: "/dashboard/supporter/contributions",
      eventKey: "contribution-decision:contribution_1:approved",
    });

    const replay = await patchDecision({ app, decision: "approved" }).expect(200);

    expect(replay.body.data.contribution.status).toBe("approved");
    expect(database.state.creditTransactions).toHaveLength(1);
    expect(database.state.notifications).toHaveLength(1);
    expect(database.state.campaigns[0].amountRaised).toBe(200);
  });

  it("rejects a pending contribution once and refunds the supporter", async () => {
    const database = createFakeDatabase({
      users: [creatorUser, supporterUser],
      campaigns: [campaignFixture()],
      contributions: [contributionFixture()],
    });
    const app = createContributionApp(database);

    const response = await patchDecision({ app, decision: "rejected", key: "reject-key-1" }).expect(200);

    expect(response.body.data.contribution).toMatchObject({
      id: "contribution_1",
      status: "rejected",
      decidedBy: "users_creator",
    });
    expect(database.state.contributions[0]).toMatchObject({
      status: "rejected",
      decisionIdempotencyKey: "reject-key-1",
      decidedBy: "users_creator",
    });
    expect(database.state.contributions[0].refundedAt).toBeTruthy();
    expect(database.state.users.find((user) => user._id === "users_supporter").credits).toBe(200);
    expect(database.state.campaigns[0].amountRaised).toBe(125);
    expect(database.state.users.find((user) => user._id === "users_creator").creatorBalance.lifetimeRaised).toBe(125);
    expect(database.state.creditTransactions[0]).toMatchObject({
      type: "contribution_refund",
      amount: 75,
      balanceAfter: 200,
      idempotencyKey: "contribution-rejection:contribution_1:reject-key-1",
    });
    expect(database.state.notifications[0]).toMatchObject({
      eventKey: "contribution-decision:contribution_1:rejected",
    });
  });

  it("rejects stale or missing-key decision attempts without extra side effects", async () => {
    const database = createFakeDatabase({
      users: [creatorUser, supporterUser],
      campaigns: [campaignFixture()],
      contributions: [
        contributionFixture({
          status: "approved",
          decisionIdempotencyKey: "old-key-1",
          decidedAt: new Date("2026-07-11T00:00:00.000Z"),
          decidedBy: "users_creator",
        }),
      ],
    });
    const app = createContributionApp(database);

    const conflict = await patchDecision({ app, key: "new-key-1", decision: "approved" }).expect(409);
    expect(conflict.body.error.code).toBe("CONTRIBUTION_DECISION_CONFLICT");
    expect(database.state.creditTransactions).toHaveLength(0);
    expect(database.state.notifications).toHaveLength(0);

    const validation = await request(app)
      .patch("/api/v1/creator/contributions/contribution_1/decision")
      .set("Authorization", `Bearer ${createAccessToken(creatorUser)}`)
      .send({ decision: "approved" })
      .expect(400);

    expect(validation.body.error.code).toBe("VALIDATION_ERROR");
  });
});
