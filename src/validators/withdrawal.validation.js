import { z } from "zod";

const positiveInt = (fieldName) =>
  z.coerce
    .number({ errorMap: () => ({ message: `${fieldName} is required.` }) })
    .int(`${fieldName} must be an integer.`)
    .positive(`${fieldName} must be greater than zero.`);

export const createWithdrawalSchema = z.object({
  body: z
    .object({
      credits: positiveInt("Withdrawal credits")
        .min(200, "Withdrawal credits must be at least 200."),
      paymentSystem: z.string().trim().min(2, "Payment system is required."),
      accountNumber: z.string().trim().min(3, "Account number is required."),
    })
    .strict(),
  params: z.object({}),
  query: z.object({}),
  headers: z
    .object({
      "idempotency-key": z.string().trim().min(8).max(120, "Idempotency key must be between 8 and 120 characters."),
    })
    .passthrough(),
});

export const listCreatorWithdrawalsSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({}),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(10),
    status: z.enum(["pending", "approved", "rejected"]).optional(),
  }),
  headers: z.object({}).passthrough(),
});

export const listAdminWithdrawalsSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({}),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(10),
    status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
  }),
  headers: z.object({}).passthrough(),
});

export const withdrawalIdSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({
    withdrawalId: z.string().trim().min(1, "Withdrawal id is required."),
  }),
  query: z.object({}),
  headers: z.object({}).passthrough(),
});

export const approveWithdrawalSchema = z.object({
  body: z.object({}).passthrough().optional(),
  params: z.object({
    withdrawalId: z.string().trim().min(1, "Withdrawal id is required."),
  }),
  query: z.object({}),
  headers: z
    .object({
      "idempotency-key": z.string().trim().min(8).max(120),
    })
    .passthrough(),
});
