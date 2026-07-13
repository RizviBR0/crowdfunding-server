import { z } from "zod";

export const createReportSchema = z.object({
  body: z.object({ reason: z.string().trim().min(10).max(1000) }).strict(),
  params: z.object({ campaignId: z.string().trim().min(1) }),
  query: z.object({}),
  headers: z.object({}).passthrough(),
});

export const listReportsSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({}),
  query: z.object({
    status: z.enum(["open", "resolved", "all"]).default("open"),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(20),
  }),
  headers: z.object({}).passthrough(),
});

export const resolveReportSchema = z.object({
  body: z.object({ action: z.enum(["suspend", "delete", "dismiss"]), reason: z.string().trim().max(500).optional() }).strict(),
  params: z.object({ reportId: z.string().trim().min(1) }),
  query: z.object({}),
  headers: z.object({}).passthrough(),
});
