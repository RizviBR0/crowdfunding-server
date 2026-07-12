import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

const getPathValue = (record, path) =>
  path.split(".").reduce((value, part) => (value == null ? value : value[part]), record);

const pickProjectedFields = (record, projection) => {
  const picked = {};

  Object.entries(projection).forEach(([field, shouldInclude]) => {
    if (shouldInclude && field in record) {
      picked[field] = record[field];
    }
  });

  return picked;
};

const compareValues = (left, right) => {
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;

  if (leftValue > rightValue) {
    return 1;
  }

  if (leftValue < rightValue) {
    return -1;
  }

  return 0;
};

const matchesValue = (actual, expected) => {
  if (expected instanceof RegExp) {
    return expected.test(actual ?? "");
  }

  if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
    if ("$gte" in expected && compareValues(actual, expected.$gte) < 0) {
      return false;
    }

    if ("$lte" in expected && compareValues(actual, expected.$lte) > 0) {
      return false;
    }

    if ("$ne" in expected && actual === expected.$ne) {
      return false;
    }

    return true;
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

const createFindCursor = (records) => {
  let workingRecords = [...records];

  return {
    sort(sortSpec) {
      const entries = Object.entries(sortSpec);

      workingRecords = [...workingRecords].sort((left, right) => {
        for (const [field, direction] of entries) {
          const comparison = compareValues(getPathValue(left, field) ?? 0, getPathValue(right, field) ?? 0);

          if (comparison !== 0) {
            return direction > 0 ? comparison : -comparison;
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
    project(projection) {
      workingRecords = workingRecords.map((record) => pickProjectedFields(record, projection));
      return this;
    },
    async toArray() {
      return workingRecords;
    },
  };
};

const createFakeDatabase = ({ campaigns = [] } = {}) => ({
  collection(name) {
    if (name !== "campaigns") {
      throw new Error(`Unexpected collection ${name}`);
    }

    return {
      async findOne(filter) {
        return campaigns.find((campaign) => matchesFilter(campaign, filter)) ?? null;
      },
      find(filter) {
        return createFindCursor(campaigns.filter((campaign) => matchesFilter(campaign, filter)));
      },
      async countDocuments(filter) {
        return campaigns.filter((campaign) => matchesFilter(campaign, filter)).length;
      },
    };
  },
});

const campaignFixture = (overrides = {}) => ({
  _id: "campaign_1",
  title: "Community Robotics Lab",
  story: "A practical robotics lab for local students to build useful inventions.",
  category: "Education",
  fundingGoal: 18000,
  minimumContribution: 25,
  deadline: new Date("2027-09-01T00:00:00.000Z"),
  rewardInfo: "Backers get progress updates.",
  imageUrl: "https://example.com/robotics.jpg",
  creatorId: "users_creator",
  creatorName: "Chris Creator",
  creatorEmail: "creator@example.com",
  amountRaised: 1250,
  status: "approved",
  moderation: { action: "approved", reason: "Internal note" },
  privateReviewerNote: "Do not expose",
  createdAt: new Date("2026-07-03T00:00:00.000Z"),
  updatedAt: new Date("2026-07-03T00:00:00.000Z"),
  deletedAt: null,
  ...overrides,
});

describe("public campaign discovery", () => {
  it("lists only approved non-expired campaigns with safe card fields and pagination metadata", async () => {
    const database = createFakeDatabase({
      campaigns: [
        campaignFixture({ _id: "campaign_old", title: "Expired Approved", deadline: new Date("2020-01-01T00:00:00.000Z") }),
        campaignFixture({ _id: "campaign_pending", title: "Pending Project", status: "pending" }),
        campaignFixture({ _id: "campaign_suspended", title: "Suspended Project", status: "suspended" }),
        campaignFixture({
          _id: "campaign_active_1",
          title: "Book Garden",
          category: "Education",
          amountRaised: 500,
          createdAt: new Date("2026-07-05T00:00:00.000Z"),
        }),
        campaignFixture({
          _id: "campaign_active_2",
          title: "Solar Tiny Homes",
          category: "Environment",
          amountRaised: 900,
          createdAt: new Date("2026-07-06T00:00:00.000Z"),
        }),
      ],
    });
    const app = createApp({ databaseProvider: () => database });

    const response = await request(app).get("/api/v1/campaigns?page=1&limit=1").expect(200);

    expect(response.body.data.campaigns).toHaveLength(1);
    expect(response.body.data.campaigns[0]).toMatchObject({
      id: "campaign_active_2",
      title: "Solar Tiny Homes",
      creatorName: "Chris Creator",
      fundingGoal: 18000,
      amountRaised: 900,
      coverImageUrl: "https://example.com/robotics.jpg",
    });
    expect(response.body.data.campaigns[0]).not.toHaveProperty("story");
    expect(response.body.data.campaigns[0]).not.toHaveProperty("creatorEmail");
    expect(response.body.data.campaigns[0]).not.toHaveProperty("moderation");
    expect(response.body.meta).toEqual({
      page: 1,
      limit: 1,
      totalItems: 2,
      totalPages: 2,
      hasNext: true,
      hasPrev: false,
    });
  });

  it("applies public category, search, deadline, and funding goal filters", async () => {
    const database = createFakeDatabase({
      campaigns: [
        campaignFixture({
          _id: "campaign_robotics",
          title: "Robotics Kits for Kids",
          story: "Hands-on robotics learning for every classroom.",
          category: "Education",
          fundingGoal: 12000,
          deadline: new Date("2027-04-15T00:00:00.000Z"),
        }),
        campaignFixture({
          _id: "campaign_clinic",
          title: "Mobile Health Clinic",
          story: "Care access for rural families.",
          category: "Health",
          fundingGoal: 24000,
          deadline: new Date("2027-04-20T00:00:00.000Z"),
        }),
      ],
    });
    const app = createApp({ databaseProvider: () => database });

    const response = await request(app)
      .get(
        "/api/v1/campaigns?search=robotics&category=Education&deadlineFrom=2027-04-01&deadlineTo=2027-04-30&goalMin=10000&goalMax=15000",
      )
      .expect(200);

    expect(response.body.data.campaigns.map((campaign) => campaign.id)).toEqual(["campaign_robotics"]);
    expect(response.body.meta.totalItems).toBe(1);
  });

  it("returns safe details only for approved active campaigns", async () => {
    const database = createFakeDatabase({
      campaigns: [
        campaignFixture({ _id: "campaign_active" }),
        campaignFixture({ _id: "campaign_expired", deadline: new Date("2020-01-01T00:00:00.000Z") }),
        campaignFixture({ _id: "campaign_rejected", status: "rejected" }),
      ],
    });
    const app = createApp({ databaseProvider: () => database });

    const response = await request(app).get("/api/v1/campaigns/campaign_active").expect(200);

    expect(response.body.data.campaign).toMatchObject({
      id: "campaign_active",
      title: "Community Robotics Lab",
      story: "A practical robotics lab for local students to build useful inventions.",
      minimumContribution: 25,
      rewardInfo: "Backers get progress updates.",
      status: "approved",
    });
    expect(response.body.data.campaign).not.toHaveProperty("creatorEmail");
    expect(response.body.data.campaign).not.toHaveProperty("privateReviewerNote");
    expect(response.body.data.campaign).not.toHaveProperty("moderation");

    await request(app).get("/api/v1/campaigns/campaign_expired").expect(404);
    await request(app).get("/api/v1/campaigns/campaign_rejected").expect(404);
  });

  it("validates public discovery bounds before database access", async () => {
    const app = createApp({ databaseProvider: () => createFakeDatabase() });

    const response = await request(app).get("/api/v1/campaigns?limit=51&goalMin=200&goalMax=100").expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
