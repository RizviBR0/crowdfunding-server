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
