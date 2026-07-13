import { z } from "zod";

const positiveInt = (fieldName) =>
  z.coerce
    .number({ error: `${fieldName} is required.` })
    .int(`${fieldName} must be an integer.`)
    .positive(`${fieldName} must be greater than zero.`);

const httpsUrl = z
  .string()
  .trim()
  .url("Campaign image must be a valid URL.")
  .refine((value) => value.startsWith("https://"), "Campaign image must use HTTPS.");

export const createCampaignSchema = z
  .object({
    body: z
      .object({
        title: z.string().trim().min(3).max(120),
        story: z.string().trim().min(20).max(5000),
        category: z.string().trim().min(2).max(50),
        fundingGoal: positiveInt("Funding goal"),
        minimumContribution: positiveInt("Minimum contribution"),
        deadline: z.coerce.date(),
        rewardInfo: z.string().trim().min(2).max(800),
        imageUrl: httpsUrl,
      })
      .strict()
      .refine((body) => body.minimumContribution <= body.fundingGoal, {
        message: "Minimum contribution cannot exceed the funding goal.",
        path: ["minimumContribution"],
      }),
    params: z.object({}),
    query: z.object({}),
    headers: z.object({}).passthrough(),
  });

export const listCreatorCampaignsSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({}),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(10),
  }),
  headers: z.object({}).passthrough(),
});

export const listCreatorContributionsSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({}),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(10),
  }),
  headers: z.object({}).passthrough(),
});

export const listPublicCampaignsSchema = z
  .object({
    body: z.object({}).passthrough().optional(),
    params: z.object({}),
    query: z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(50).default(10),
      search: z.string().trim().max(80).optional(),
      category: z.string().trim().max(50).optional(),
      deadlineFrom: z.coerce.date().optional(),
      deadlineTo: z.coerce.date().optional(),
      goalMin: z.coerce.number().int().nonnegative().optional(),
      goalMax: z.coerce.number().int().positive().optional(),
    }),
    headers: z.object({}).passthrough(),
  })
  .refine(({ query }) => query.goalMin == null || query.goalMax == null || query.goalMin <= query.goalMax, {
    message: "Minimum goal cannot exceed maximum goal.",
    path: ["query", "goalMin"],
  })
  .refine(
    ({ query }) =>
      query.deadlineFrom == null || query.deadlineTo == null || query.deadlineFrom.getTime() <= query.deadlineTo.getTime(),
    {
      message: "Deadline from cannot be later than deadline to.",
      path: ["query", "deadlineFrom"],
    },
  );

export const listAdminCampaignsSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({}),
  query: z.object({
    status: z.enum(["pending", "approved", "rejected", "suspended", "deleted", "all"]).default("pending"),
    search: z.string().trim().max(80).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(10),
  }),
  headers: z.object({}).passthrough(),
});

export const campaignIdSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({
    campaignId: z.string().trim().min(1, "Campaign id is required."),
  }),
  query: z.object({}),
  headers: z.object({}).passthrough(),
});

export const updateCampaignSchema = z.object({
  body: z
    .object({
      title: z.string().trim().min(3).max(120).optional(),
      story: z.string().trim().min(20).max(5000).optional(),
      rewardInfo: z.string().trim().min(2).max(800).optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one editable campaign field is required.",
    }),
  params: z.object({
    campaignId: z.string().trim().min(1, "Campaign id is required."),
  }),
  query: z.object({}),
  headers: z.object({}).passthrough(),
});

export const createContributionSchema = z.object({
  body: z
    .object({
      amount: positiveInt("Contribution amount"),
      message: z.string().trim().max(800).optional().default(""),
    })
    .strict(),
  params: z.object({
    campaignId: z.string().trim().min(1, "Campaign id is required."),
  }),
  query: z.object({}),
  headers: z
    .object({
      "idempotency-key": z.string().trim().min(8).max(120),
    })
    .passthrough(),
});

export const creatorContributionIdSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({
    contributionId: z.string().trim().min(1, "Contribution id is required."),
  }),
  query: z.object({}),
  headers: z.object({}).passthrough(),
});

export const creatorContributionDecisionSchema = z.object({
  body: z
    .object({
      decision: z.enum(["approved", "rejected"]),
    })
    .strict(),
  params: z.object({
    contributionId: z.string().trim().min(1, "Contribution id is required."),
  }),
  query: z.object({}),
  headers: z
    .object({
      "idempotency-key": z.string().trim().min(8).max(120),
    })
    .passthrough(),
});

export const adminCampaignDecisionSchema = z.object({
  body: z
    .object({
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().trim().max(500).optional(),
    })
    .strict(),
  params: z.object({
    campaignId: z.string().trim().min(1, "Campaign id is required."),
  }),
  query: z.object({}),
  headers: z.object({}).passthrough(),
});

export const adminCampaignDeleteSchema = z.object({
  body: z
    .object({
      reason: z.string().trim().max(500).optional(),
    })
    .strict()
    .optional()
    .default({}),
  params: z.object({
    campaignId: z.string().trim().min(1, "Campaign id is required."),
  }),
  query: z.object({}),
  headers: z.object({}).passthrough(),
});

export const adminCampaignSuspendSchema = z.object({
  body: z
    .object({
      reason: z.string().trim().min(3).max(500),
    })
    .strict(),
  params: z.object({
    campaignId: z.string().trim().min(1, "Campaign id is required."),
  }),
  query: z.object({}),
  headers: z.object({}).passthrough(),
});

export const supporterContributionStatsSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({}),
  query: z.object({}),
  headers: z.object({}).passthrough(),
});

export const listSupporterApprovedContributionsSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({}),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(10),
  }),
  headers: z.object({}).passthrough(),
});

export const listSupporterContributionsSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({}),
  query: z.object({
    status: z.enum(["pending", "approved", "rejected", "refunded"]).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(10),
  }),
  headers: z.object({}).passthrough(),
});

