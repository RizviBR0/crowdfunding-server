import { z } from "zod";
import { CREDIT_PACKAGES } from "../services/paymentService.js";
import { ApiError } from "../errors/ApiError.js";

export const validateCheckoutSessionRequest = (req, res, next) => {
  const schema = z.object({
    packageId: z.string().refine((val) => Object.keys(CREDIT_PACKAGES).includes(val), {
      message: "Invalid package selection.",
    }),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    const errorDetails = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    return next(new ApiError(400, "VALIDATION_ERROR", errorDetails));
  }

  req.body = parsed.data;
  next();
};
