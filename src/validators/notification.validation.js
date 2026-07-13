import { z } from "zod";

export const listNotificationsSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({}),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(20),
  }),
  headers: z.object({}).passthrough(),
});

export const notificationIdSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({ notificationId: z.string().trim().min(1) }),
  query: z.object({}),
  headers: z.object({}).passthrough(),
});
