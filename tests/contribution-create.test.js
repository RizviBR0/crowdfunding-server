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
    if ("$gte" in expected && !(actual >= expected.$gte)) {
      return false;
    }

    if ("$lte" in expected && !(actual <= expected.$lte)) {
      return false;
    }

    if ("$ne" in expected) {
      return actual !== expected.$ne;
    }

    if ("$in" in expected) {
      return expected.$in.includes(actual);
    }

    return true;
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

const createFindCursor = (records) => ({
  async toArray() {
    return records;
  },
});

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

const postContribution = ({ app, user = supporterUser, key = "contribution-key-1", body = { amount: 75 } }) =>
  request(app)
    .post("/api/v1/campaigns/campaign_1/contributions")
    .set("Authorization", `Bearer ${createAccessToken(user)}`)
    .set("Idempotency-Key", key)
    .send(body);

describe("supporter contribution creation", () => {
  it("creates a pending contribution, debits credits, writes ledger, and notifies the creator", async () => {
    const database = createFakeDatabase({
      users: [supporterUser],
      campaigns: [campaignFixture()],
    });
    const app = createContributionApp(database);

    const response = await postContribution({
      app,
      body: { amount: 75, message: "Excited to help this bloom." },
    }).expect(201);

    expect(response.body.data.contribution).toMatchObject({
      campaignId: "campaign_1",
      campaignTitle: "Community Robotics Lab",
      amount: 75,
      supporterEmail: "supporter@example.com",
      supporterName: "Sam Supporter",
      creatorEmail: "creator@example.com",
      creatorName: "Chris Creator",
      message: "Excited to help this bloom.",
      status: "pending",
    });
    expect(database.state.users[0].credits).toBe(125);
    expect(database.state.contributions).toHaveLength(1);
    expect(database.state.contributions[0]).toMatchObject({
      idempotencyKey: "contribution-key-1",
      status: "pending",
    });
    expect(database.state.creditTransactions[0]).toMatchObject({
      type: "contribution_debit",
      amount: -75,
      balanceAfter: 125,
      idempotencyKey: "contribution:users_supporter:contribution-key-1",
    });
    expect(database.state.notifications[0]).toMatchObject({
      type: "contribution_created",
      toEmail: "creator@example.com",
      actionRoute: "/dashboard/creator",
      eventKey: "contribution-created:contributions_1",
    });
  });

  it("blocks non-supporter roles before contribution creation", async () => {
    const database = createFakeDatabase({
      users: [creatorUser],
      campaigns: [campaignFixture()],
    });
    const app = createContributionApp(database);

    const response = await postContribution({ app, user: creatorUser }).expect(403);

    expect(response.body.error.code).toBe("ROLE_FORBIDDEN");
    expect(database.state.contributions).toHaveLength(0);
  });

  it("rejects invalid campaign state, below-minimum amount, and insufficient credits", async () => {
    const inactiveDatabase = createFakeDatabase({
      users: [supporterUser],
      campaigns: [campaignFixture({ status: "pending" })],
    });
    const inactive = await postContribution({ app: createContributionApp(inactiveDatabase) }).expect(404);
    expect(inactive.body.error.code).toBe("CAMPAIGN_NOT_FOUND");

    const belowMinimumDatabase = createFakeDatabase({
      users: [supporterUser],
      campaigns: [campaignFixture()],
    });
    const belowMinimum = await postContribution({
      app: createContributionApp(belowMinimumDatabase),
      key: "contribution-key-2",
      body: { amount: 10 },
    }).expect(400);
    expect(belowMinimum.body.error.code).toBe("CONTRIBUTION_BELOW_MINIMUM");

    const lowCreditDatabase = createFakeDatabase({
      users: [{ ...supporterUser, credits: 50 }],
      campaigns: [campaignFixture()],
    });
    const lowCredit = await postContribution({
      app: createContributionApp(lowCreditDatabase),
      key: "contribution-key-3",
      body: { amount: 75 },
    }).expect(409);
    expect(lowCredit.body.error.code).toBe("INSUFFICIENT_CREDITS");
    expect(lowCreditDatabase.state.contributions).toHaveLength(0);
  });

  it("replays identical idempotent requests and rejects conflicting reuse", async () => {
    const database = createFakeDatabase({
      users: [supporterUser],
      campaigns: [campaignFixture()],
    });
    const app = createContributionApp(database);

    await postContribution({ app, body: { amount: 75, message: "Count me in." } }).expect(201);
    const replay = await postContribution({ app, body: { amount: 75, message: "Count me in." } }).expect(200);

    expect(replay.body.data.contribution).toMatchObject({
      amount: 75,
      status: "pending",
    });
    expect(database.state.users[0].credits).toBe(125);
    expect(database.state.contributions).toHaveLength(1);
    expect(database.state.creditTransactions).toHaveLength(1);

    const conflict = await postContribution({
      app,
      body: { amount: 80, message: "Different payload." },
    }).expect(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("rejects amounts that exceed remaining campaign capacity including pending reservations", async () => {
    const database = createFakeDatabase({
      users: [{ ...supporterUser, credits: 500 }],
      campaigns: [campaignFixture({ fundingGoal: 500, amountRaised: 350 })],
      contributions: [
        {
          _id: "contribution_existing",
          campaignId: "campaign_1",
          amount: 100,
          supporterId: "users_other",
          status: "pending",
        },
      ],
    });
    const app = createContributionApp(database);

    const response = await postContribution({
      app,
      key: "capacity-key-1",
      body: { amount: 75 },
    }).expect(409);

    expect(response.body.error.code).toBe("CONTRIBUTION_EXCEEDS_REMAINING_GOAL");
    expect(database.state.users[0].credits).toBe(500);
    expect(database.state.creditTransactions).toHaveLength(0);
  });

  it("rejects campaigns with no remaining funding capacity", async () => {
    const database = createFakeDatabase({
      users: [supporterUser],
      campaigns: [campaignFixture({ fundingGoal: 500, amountRaised: 500 })],
    });
    const app = createContributionApp(database);

    const response = await postContribution({
      app,
      key: "capacity-key-2",
      body: { amount: 25 },
    }).expect(409);

    expect(response.body.error.code).toBe("CAMPAIGN_GOAL_REACHED");
    expect(database.state.contributions).toHaveLength(0);
  });
});
