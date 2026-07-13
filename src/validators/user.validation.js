import { z } from "zod";

const userId = z.object({ userId: z.string().trim().min(1) });
const common = { body: z.object({}).passthrough().optional(), query: z.object({}), headers: z.object({}).passthrough() };

export const listUsersSchema = z.object({
  ...common,
  params: z.object({}),
  query: z.object({
    search: z.string().trim().max(80).optional(),
    role: z.enum(["admin", "creator", "supporter", "all"]).default("all"),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(20),
  }),
});

export const userIdSchema = z.object({ ...common, params: userId });
export const updateUserRoleSchema = z.object({
  body: z.object({ role: z.enum(["admin", "creator", "supporter"]) }).strict(),
  params: userId,
  query: z.object({}),
  headers: z.object({}).passthrough(),
});
