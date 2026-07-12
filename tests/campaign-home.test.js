import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

const pickProjectedFields = (record, projection) => {
  const picked = {};

  Object.entries(projection).forEach(([field, shouldInclude]) => {
    if (shouldInclude && field in record) {
      picked[field] = record[field];
    }
  });

  return picked;
};

const createFindCursor = (records) => {
  let workingRecords = [...records];

  return {
    sort(sortSpec) {
      const entries = Object.entries(sortSpec);

      workingRecords = [...workingRecords].sort((left, right) => {
        for (const [field, direction] of entries) {
          const leftValue = left[field] ?? 0;
          const rightValue = right[field] ?? 0;

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
    limit(limit) {
      workingRecords = workingRecords.slice(0, limit);
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

const createAggregateCursor = (records) => ({
  async toArray() {
    const categories = new Set(records.map((campaign) => campaign.category).filter(Boolean));

    if (records.length === 0) {
      return [];
    }

    return [
      {
        approvedCampaigns: records.length,
        totalRaisedCredits: records.reduce((total, campaign) => total + (campaign.amountRaised ?? 0), 0),
        totalFundingGoal: records.reduce((total, campaign) => total + (campaign.fundingGoal ?? 0), 0),
        categoriesCount: categories.size,
      },
    ];
  },
});

const matchesFilter = (record, filter) => Object.entries(filter).every(([key, value]) => record[key] === value);

const createFakeDatabase = ({ campaigns = [] } = {}) => ({
  collection(name) {
    if (name !== "campaigns") {
      throw new Error(`Unexpected collection ${name}`);
    }

    return {
      find(filter) {
        return createFindCursor(campaigns.filter((campaign) => matchesFilter(campaign, filter)));
      },
      aggregate() {
        return createAggregateCursor(campaigns.filter((campaign) => campaign.status === "approved"));
      },
    };
  },
});

const createCampaign = (overrides) => ({
  _id: overrides._id,
  title: overrides.title,
  category: overrides.category ?? "Technology",
  imageUrl: overrides.imageUrl ?? "https://example.com/campaign.jpg",
  creatorName: overrides.creatorName ?? "Creator Name",
  creatorEmail: overrides.creatorEmail ?? "creator@example.com",
  fundingGoal: overrides.fundingGoal ?? 1000,
  amountRaised: overrides.amountRaised ?? 0,
  deadline: overrides.deadline ?? new Date("2026-12-31T00:00:00.000Z"),
  status: overrides.status ?? "approved",
  privateReviewerNote: overrides.privateReviewerNote ?? "do not expose",
  createdAt: overrides.createdAt ?? new Date("2026-07-01T00:00:00.000Z"),
});

describe("public campaign homepage data", () => {
  it("returns the top six approved campaigns sorted by raised credits with safe fields", async () => {
    const database = createFakeDatabase({
      campaigns: [
        createCampaign({ _id: "campaign_1", title: "Pending Solar Home", status: "pending", amountRaised: 9999 }),
        createCampaign({ _id: "campaign_2", title: "Robotics Club", amountRaised: 670 }),
        createCampaign({ _id: "campaign_3", title: "Art Kits", category: "Arts", amountRaised: 450 }),
        createCampaign({ _id: "campaign_4", title: "Mobile Clinic", category: "Health", amountRaised: 780 }),
        createCampaign({ _id: "campaign_5", title: "Garden Team", category: "Community", amountRaised: 360 }),
        createCampaign({ _id: "campaign_6", title: "Learning Laptops", category: "Education", amountRaised: 910 }),
        createCampaign({ _id: "campaign_7", title: "Tiny Homes", category: "Environment", amountRaised: 820 }),
        createCampaign({ _id: "campaign_8", title: "Book Corner", category: "Education", amountRaised: 120 }),
      ],
    });
    const app = createApp({ databaseProvider: () => database });

    const response = await request(app).get("/api/v1/campaigns/top-funded").expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.campaigns).toHaveLength(6);
    expect(response.body.data.campaigns.map((campaign) => campaign.title)).toEqual([
      "Learning Laptops",
      "Tiny Homes",
      "Mobile Clinic",
      "Robotics Club",
      "Art Kits",
      "Garden Team",
    ]);
    expect(response.body.data.campaigns[0]).toMatchObject({
      id: "campaign_6",
      title: "Learning Laptops",
      coverImageUrl: "https://example.com/campaign.jpg",
      amountRaised: 910,
    });
    expect(response.body.data.campaigns[0]).not.toHaveProperty("creatorEmail");
    expect(response.body.data.campaigns[0]).not.toHaveProperty("privateReviewerNote");
  });

  it("returns safe aggregate impact totals for approved campaigns only", async () => {
    const database = createFakeDatabase({
      campaigns: [
        createCampaign({ _id: "campaign_1", title: "Approved One", category: "Education", amountRaised: 100, fundingGoal: 500 }),
        createCampaign({ _id: "campaign_2", title: "Approved Two", category: "Health", amountRaised: 250, fundingGoal: 700 }),
        createCampaign({ _id: "campaign_3", title: "Rejected", status: "rejected", amountRaised: 400, fundingGoal: 900 }),
      ],
    });
    const app = createApp({ databaseProvider: () => database });

    const response = await request(app).get("/api/v1/campaigns/top-funded").expect(200);

    expect(response.body.data.impact).toEqual({
      approvedCampaigns: 2,
      totalRaisedCredits: 350,
      totalFundingGoal: 1200,
      categoriesCount: 2,
    });
  });

  it("returns empty homepage data when no campaigns are approved", async () => {
    const database = createFakeDatabase({
      campaigns: [createCampaign({ _id: "campaign_1", title: "Draft", status: "pending" })],
    });
    const app = createApp({ databaseProvider: () => database });

    const response = await request(app).get("/api/v1/campaigns/top-funded").expect(200);

    expect(response.body.data).toEqual({
      campaigns: [],
      impact: {
        approvedCampaigns: 0,
        totalRaisedCredits: 0,
        totalFundingGoal: 0,
        categoriesCount: 0,
      },
    });
  });
});
