import { ObjectId } from "mongodb";
import { ApiError } from "../errors/ApiError.js";

const toObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : id);

export const toWithdrawal = (w) => ({
  id: w._id?.toString?.() ?? w.id,
  creatorId: w.creatorId?.toString?.() ?? w.creatorId,
  creatorEmail: w.creatorEmail,
  creatorName: w.creatorName,
  withdrawalCredit: w.withdrawalCredit,
  withdrawalAmountCents: w.withdrawalAmountCents,
  paymentSystem: w.paymentSystem,
  accountNumberEncryptedOrMasked: w.accountNumberEncryptedOrMasked,
  status: w.status,
  idempotencyKey: w.idempotencyKey,
  decisionIdempotencyKey: w.decisionIdempotencyKey ?? null,
  withdrawDate: w.withdrawDate,
  processedAt: w.processedAt ?? null,
  processedBy: w.processedBy?.toString?.() ?? w.processedBy ?? null,
});

const runInTransaction = async (database, operation) => {
  const session = database.client?.startSession ? database.client.startSession() : null;

  if (!session) {
    return operation(undefined);
  }

  try {
    return await session.withTransaction(() => operation(session));
  } finally {
    await session.endSession();
  }
};

export const getEarnings = async ({ database, creatorId }) => {
  const user = await database.collection("users").findOne({ _id: toObjectId(creatorId) });
  if (!user || user.status !== "active") {
    throw new ApiError(404, "USER_NOT_FOUND", "Creator not found.");
  }

  const lifetimeRaised = user.creatorBalance?.lifetimeRaised ?? 0;
  const reservedForWithdrawal = user.creatorBalance?.reservedForWithdrawal ?? 0;
  const withdrawn = user.creatorBalance?.withdrawn ?? 0;
  const withdrawable = lifetimeRaised - reservedForWithdrawal - withdrawn;
  const withdrawableAmountCents = withdrawable * 5;

  return {
    lifetimeRaised,
    reservedForWithdrawal,
    withdrawn,
    withdrawable,
    withdrawableAmountCents,
  };
};

export const createWithdrawalRequest = async ({
  database,
  creatorId,
  credits,
  paymentSystem,
  accountNumber,
  idempotencyKey,
  now = new Date(),
}) => {
  const creatorObjectId = toObjectId(creatorId);

  return runInTransaction(database, async (session) => {
    const sessionOption = session ? { session } : undefined;

    // 1. Idempotency Check
    const existing = await database.collection("withdrawals").findOne(
      { creatorId: creatorObjectId, idempotencyKey },
      sessionOption,
    );

    if (existing) {
      if (
        existing.withdrawalCredit === credits &&
        existing.paymentSystem === paymentSystem
      ) {
        return { withdrawal: toWithdrawal(existing), replayed: true };
      }
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "A withdrawal with this key already exists with different details.");
    }

    // 2. Fetch User and check available balance
    const creator = await database.collection("users").findOne({ _id: creatorObjectId }, sessionOption);
    if (!creator || creator.status !== "active" || creator.role !== "creator") {
      throw new ApiError(404, "USER_NOT_FOUND", "Creator not found or is inactive.");
    }

    const lifetimeRaised = creator.creatorBalance?.lifetimeRaised ?? 0;
    const reservedForWithdrawal = creator.creatorBalance?.reservedForWithdrawal ?? 0;
    const withdrawn = creator.creatorBalance?.withdrawn ?? 0;
    const withdrawable = lifetimeRaised - reservedForWithdrawal - withdrawn;

    if (credits > withdrawable) {
      throw new ApiError(400, "INSUFFICIENT_CREDITS", "Insufficient withdrawable credit balance.");
    }

    const withdrawalAmountCents = credits * 5;
    const maskedAccount = accountNumber.length > 4 
      ? "*".repeat(accountNumber.length - 4) + accountNumber.slice(-4) 
      : accountNumber;

    // 3. Insert Withdrawal Request
    const withdrawalDoc = {
      creatorId: creatorObjectId,
      creatorEmail: creator.email,
      creatorName: creator.displayName,
      withdrawalCredit: credits,
      withdrawalAmountCents,
      paymentSystem,
      accountNumberEncryptedOrMasked: maskedAccount,
      status: "pending",
      idempotencyKey,
      withdrawDate: now,
      processedAt: null,
      processedBy: null,
    };

    const insertResult = await database.collection("withdrawals").insertOne(withdrawalDoc, sessionOption);
    const createdWithdrawal = { ...withdrawalDoc, _id: insertResult.insertedId };

    // 4. Update User creatorBalance
    await database.collection("users").updateOne(
      { _id: creatorObjectId },
      { $inc: { "creatorBalance.reservedForWithdrawal": credits } },
      sessionOption,
    );

    // 5. Record Ledger transaction
    const newWithdrawable = withdrawable - credits;
    const ledgerEntry = {
      userId: creatorObjectId,
      type: "withdrawal_reserve",
      amount: -credits,
      balanceType: "creator_withdrawable",
      referenceType: "withdrawal",
      referenceId: insertResult.insertedId.toString(),
      idempotencyKey: `withdrawal_reserve:${creatorObjectId.toString()}:${idempotencyKey}`,
      balanceAfter: newWithdrawable,
      createdAt: now,
      metadata: {
        credits,
        paymentSystem,
        withdrawalId: insertResult.insertedId.toString(),
      },
    };

    await database.collection("creditTransactions").insertOne(ledgerEntry, sessionOption);

    return { withdrawal: toWithdrawal(createdWithdrawal), replayed: false };
  });
};

export const listWithdrawals = async ({ database, creatorId, status, page = 1, limit = 10 }) => {
  const filter = {};
  if (creatorId) {
    filter.creatorId = toObjectId(creatorId);
  }

  if (status && status !== "all") {
    filter.status = status;
  }

  const skip = (page - 1) * limit;
  const withdrawalsCollection = database.collection("withdrawals");

  const [withdrawals, totalCount] = await Promise.all([
    withdrawalsCollection
      .find(filter)
      .sort({ withdrawDate: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    withdrawalsCollection.countDocuments(filter),
  ]);

  return {
    withdrawals: withdrawals.map(toWithdrawal),
    meta: {
      totalItems: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      hasNext: page * limit < totalCount,
      hasPrev: page > 1,
    },
  };
};

export const decideWithdrawal = async ({
  database,
  admin,
  withdrawalId,
  decision,
  idempotencyKey,
  now = new Date(),
}) => {
  const withdrawalObjectId = toObjectId(withdrawalId);

  return runInTransaction(database, async (session) => {
    const sessionOption = session ? { session } : undefined;

    const withdrawal = await database.collection("withdrawals").findOne({ _id: withdrawalObjectId }, sessionOption);
    if (!withdrawal) {
      throw new ApiError(404, "WITHDRAWAL_NOT_FOUND", "Withdrawal request was not found.");
    }

    // 1. Handle idempotency for processed requests
    if (withdrawal.status !== "pending") {
      if (withdrawal.decisionIdempotencyKey === idempotencyKey) {
        return { withdrawal: toWithdrawal(withdrawal), replayed: true };
      }
      throw new ApiError(409, "WITHDRAWAL_DECISION_CONFLICT", "This withdrawal request has already been decided.");
    }

    const creatorId = withdrawal.creatorId;
    const creator = await database.collection("users").findOne({ _id: creatorId }, sessionOption);
    if (!creator) {
      throw new ApiError(409, "CREATOR_NOT_FOUND", "Creator account was not found.");
    }

    const credits = withdrawal.withdrawalCredit;
    const updatedWithdrawal = {
      ...withdrawal,
      status: decision,
      processedAt: now,
      processedBy: admin._id,
      decisionIdempotencyKey: idempotencyKey,
    };

    // 2. Perform updates based on decision
    if (decision === "approved") {
      // Consume reserved credits, move to withdrawn
      await database.collection("users").updateOne(
        { _id: creatorId },
        {
          $inc: {
            "creatorBalance.reservedForWithdrawal": -credits,
            "creatorBalance.withdrawn": credits,
          },
        },
        sessionOption,
      );

      // Ledger entry
      const withdrawable = (creator.creatorBalance?.lifetimeRaised ?? 0) -
        (creator.creatorBalance?.reservedForWithdrawal ?? 0) -
        (creator.creatorBalance?.withdrawn ?? 0);
      
      const ledgerEntry = {
        userId: creatorId,
        type: "withdrawal_paid",
        amount: -credits,
        balanceType: "creator_withdrawable",
        referenceType: "withdrawal",
        referenceId: withdrawalId.toString(),
        idempotencyKey: `withdrawal_paid:${creatorId.toString()}:${idempotencyKey}`,
        balanceAfter: withdrawable,
        createdAt: now,
        metadata: {
          credits,
          withdrawalId: withdrawalId.toString(),
        },
      };
      await database.collection("creditTransactions").insertOne(ledgerEntry, sessionOption);

      // Notification
      await database.collection("notifications").insertOne({
        type: "withdrawal_decision",
        message: `Your withdrawal request of ${credits} credits ($${(withdrawal.withdrawalAmountCents / 100).toFixed(2)}) was approved by admin.`,
        toUserId: creatorId,
        toEmail: creator.email,
        actionRoute: "/dashboard/creator/withdrawals",
        relatedEntity: { type: "withdrawal", id: withdrawalObjectId },
        eventKey: `withdrawal-approved:${withdrawalId.toString()}`,
        readAt: null,
        time: now,
        metadata: {
          decision: "approved",
          credits,
          amountCents: withdrawal.withdrawalAmountCents,
        },
      }, sessionOption);

    } else if (decision === "rejected") {
      // Ledger entry calculations (before DB update)
      const currentWithdrawable = (creator.creatorBalance?.lifetimeRaised ?? 0) -
        (creator.creatorBalance?.reservedForWithdrawal ?? 0) -
        (creator.creatorBalance?.withdrawn ?? 0);
      const newWithdrawable = currentWithdrawable + credits;

      // Release reservation
      await database.collection("users").updateOne(
        { _id: creatorId },
        {
          $inc: {
            "creatorBalance.reservedForWithdrawal": -credits,
          },
        },
        sessionOption,
      );

      const ledgerEntry = {
        userId: creatorId,
        type: "withdrawal_release",
        amount: credits,
        balanceType: "creator_withdrawable",
        referenceType: "withdrawal",
        referenceId: withdrawalId.toString(),
        idempotencyKey: `withdrawal_release:${creatorId.toString()}:${idempotencyKey}`,
        balanceAfter: newWithdrawable,
        createdAt: now,
        metadata: {
          credits,
          withdrawalId: withdrawalId.toString(),
        },
      };
      await database.collection("creditTransactions").insertOne(ledgerEntry, sessionOption);

      // Notification
      await database.collection("notifications").insertOne({
        type: "withdrawal_decision",
        message: `Your withdrawal request of ${credits} credits was rejected by admin.`,
        toUserId: creatorId,
        toEmail: creator.email,
        actionRoute: "/dashboard/creator/withdrawals",
        relatedEntity: { type: "withdrawal", id: withdrawalObjectId },
        eventKey: `withdrawal-rejected:${withdrawalId.toString()}`,
        readAt: null,
        time: now,
        metadata: {
          decision: "rejected",
          credits,
        },
      }, sessionOption);
    }

    // 3. Update the withdrawal status in DB
    await database.collection("withdrawals").updateOne(
      { _id: withdrawalObjectId },
      {
        $set: {
          status: decision,
          processedAt: now,
          processedBy: admin._id,
          decisionIdempotencyKey: idempotencyKey,
        },
      },
      sessionOption,
    );

    return { withdrawal: toWithdrawal(updatedWithdrawal), replayed: false };
  });
};
