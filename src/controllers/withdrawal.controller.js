import { ObjectId } from "mongodb";
import { getDatabase } from "../config/database.js";
import {
  getEarnings,
  createWithdrawalRequest,
  listWithdrawals,
  decideWithdrawal,
} from "../services/withdrawal.service.js";
import { ApiError } from "../errors/ApiError.js";

const toObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : id);

export const getCreatorEarnings = async (req, res, next) => {
  try {
    const database = req.app.locals.getDatabase?.() ?? getDatabase();
    const creatorId = req.user.id;

    const earnings = await getEarnings({ database, creatorId });
    res.status(200).json({ success: true, data: earnings });
  } catch (error) {
    next(error);
  }
};

export const createCreatorWithdrawal = async (req, res, next) => {
  try {
    const database = req.app.locals.getDatabase?.() ?? getDatabase();
    const creatorId = req.user.id;
    const { credits, paymentSystem, accountNumber } = req.validated.body;
    const idempotencyKey = req.headers["idempotency-key"];

    if (!idempotencyKey) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.");
    }

    const { withdrawal, replayed } = await createWithdrawalRequest({
      database,
      creatorId,
      credits,
      paymentSystem,
      accountNumber,
      idempotencyKey,
    });

    res.status(replayed ? 200 : 201).json({ success: true, data: withdrawal });
  } catch (error) {
    next(error);
  }
};

export const listCreatorWithdrawals = async (req, res, next) => {
  try {
    const database = req.app.locals.getDatabase?.() ?? getDatabase();
    const creatorId = req.user.id;
    const { status, page, limit } = req.validated.query;

    const result = await listWithdrawals({
      database,
      creatorId,
      status,
      page,
      limit,
    });

    res.status(200).json({ success: true, data: result.withdrawals, meta: result.meta });
  } catch (error) {
    next(error);
  }
};

export const listAdminWithdrawals = async (req, res, next) => {
  try {
    const database = req.app.locals.getDatabase?.() ?? getDatabase();
    const { status, page, limit } = req.validated.query;

    const result = await listWithdrawals({
      database,
      status,
      page,
      limit,
    });

    res.status(200).json({ success: true, data: result.withdrawals, meta: result.meta });
  } catch (error) {
    next(error);
  }
};

export const approveAdminWithdrawal = async (req, res, next) => {
  try {
    const database = req.app.locals.getDatabase?.() ?? getDatabase();
    const admin = { _id: toObjectId(req.user.id) };
    const { withdrawalId } = req.validated.params;
    const idempotencyKey = req.headers["idempotency-key"];

    if (!idempotencyKey) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.");
    }

    const { withdrawal } = await decideWithdrawal({
      database,
      admin,
      withdrawalId,
      decision: "approved",
      idempotencyKey,
    });

    res.status(200).json({ success: true, data: withdrawal });
  } catch (error) {
    next(error);
  }
};

export const rejectAdminWithdrawal = async (req, res, next) => {
  try {
    const database = req.app.locals.getDatabase?.() ?? getDatabase();
    const admin = { _id: toObjectId(req.user.id) };
    const { withdrawalId } = req.validated.params;
    const idempotencyKey = req.headers["idempotency-key"];

    if (!idempotencyKey) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.");
    }

    const { withdrawal } = await decideWithdrawal({
      database,
      admin,
      withdrawalId,
      decision: "rejected",
      idempotencyKey,
    });

    res.status(200).json({ success: true, data: withdrawal });
  } catch (error) {
    next(error);
  }
};
