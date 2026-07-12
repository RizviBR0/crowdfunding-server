import { z } from "zod";

export const sessionExchangeSchema = z.object({
  body: z.object({
    firebaseIdToken: z.string().trim().min(1, "Firebase ID token is required."),
    intendedRole: z.enum(["supporter", "creator"]).optional(),
  }),
  params: z.object({}),
  query: z.object({}),
  headers: z.object({}).passthrough(),
});
