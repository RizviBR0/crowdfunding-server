import { ObjectId } from "mongodb";

import { ApiError } from "../errors/ApiError.js";

const TOP_FUNDED_LIMIT = 6;
const REFUNDABLE_CONTRIBUTION_STATUSES = ["approved", "pending"];

const objectIdOrString = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : id);

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

const toPublicCampaignSummary = (campaign) => ({
  id: campaign._id?.toString?.() ?? campaign.id,
  title: campaign.title,
  category: campaign.category,
  coverImageUrl: campaign.imageUrl,
  creatorName: campaign.creatorName,
  fundingGoal: campaign.fundingGoal,
  amountRaised: campaign.amountRaised ?? 0,
  deadline: campaign.deadline,
});

const toPublicCampaignDetail = (campaign) => ({
  ...toPublicCampaignSummary(campaign),
  story: campaign.story,
  minimumContribution: campaign.minimumContribution,
  rewardInfo: campaign.rewardInfo,
  status: campaign.status,
  createdAt: campaign.createdAt,
  updatedAt: campaign.updatedAt,
});

const toCreatorCampaign = (campaign) => ({
  id: campaign._id?.toString?.() ?? campaign.id,
  title: campaign.title,
  story: campaign.story,
  category: campaign.category,
  fundingGoal: campaign.fundingGoal,
  minimumContribution: campaign.minimumContribution,
  deadline: campaign.deadline,
  rewardInfo: campaign.rewardInfo,
  imageUrl: campaign.imageUrl,
  creatorName: campaign.creatorName,
  creatorEmail: campaign.creatorEmail,
  amountRaised: campaign.amountRaised ?? 0,
  status: campaign.status,
  createdAt: campaign.createdAt,
  updatedAt: campaign.updatedAt,
  deletedAt: campaign.deletedAt ?? null,
});

const toAdminCampaign = (campaign) => ({
  ...toCreatorCampaign(campaign),
  creatorId: campaign.creatorId?.toString?.() ?? campaign.creatorId,
  moderation: campaign.moderation ?? null,
});

const toContribution = (contribution) => ({
  id: contribution._id?.toString?.() ?? contribution.id,
  campaignId: contribution.campaignId?.toString?.() ?? contribution.campaignId,
  campaignTitle: contribution.campaignTitle,
  amount: contribution.amount,
  supporterId: contribution.supporterId?.toString?.() ?? contribution.supporterId,
  supporterEmail: contribution.supporterEmail,
  supporterName: contribution.supporterName,
  creatorId: contribution.creatorId?.toString?.() ?? contribution.creatorId,
  creatorEmail: contribution.creatorEmail,
  creatorName: contribution.creatorName,
  message: contribution.message ?? "",
  status: contribution.status,
  createdAt: contribution.createdAt,
  decidedAt: contribution.decidedAt ?? null,
  decidedBy: contribution.decidedBy?.toString?.() ?? contribution.decidedBy ?? null,
  refundedAt: contribution.refundedAt ?? null,
});

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const createApprovedActiveCampaignFilter = ({ now, search, category, deadlineFrom, deadlineTo, goalMin, goalMax }) => {
  const deadlineLowerBound =
    deadlineFrom && deadlineFrom.getTime() > now.getTime() ? deadlineFrom : now;
  const filter = {
    status: "approved",
    deadline: { $gte: deadlineLowerBound },
  };

  if (deadlineTo) {
    filter.deadline.$lte = deadlineTo;
  }

  if (category) {
    filter.category = category;
  }

  if (goalMin != null || goalMax != null) {
    filter.fundingGoal = {};

    if (goalMin != null) {
      filter.fundingGoal.$gte = goalMin;
    }

    if (goalMax != null) {
      filter.fundingGoal.$lte = goalMax;
    }
  }

  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ title: pattern }, { story: pattern }, { category: pattern }, { creatorName: pattern }];
  }

  return filter;
};

const assertFutureDeadline = (deadline, now) => {
  if (deadline.getTime() <= now.getTime()) {
    throw new ApiError(400, "DEADLINE_IN_PAST", "Campaign deadline must be in the future.");
  }
};

const getOwnedCampaign = async ({ campaigns, campaignId, user, session }) => {
  const campaign = await campaigns.findOne(
    {
      _id: objectIdOrString(campaignId),
      creatorId: objectIdOrString(user.id),
    },
    session ? { session } : undefined,
  );

  if (!campaign) {
    throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
  }

  if (campaign.status === "deleted") {
    throw new ApiError(409, "CAMPAIGN_ALREADY_DELETED", "Campaign has already been deleted.");
  }

  return campaign;
};

const createRefundLedger = ({ contribution, campaign, now, balanceAfter }) => ({
  userId: contribution.supporterId,
  type: "campaign_delete_refund",
  amount: contribution.amount,
  balanceType: "credits",
  referenceType: "campaign",
  referenceId: campaign._id.toString(),
  idempotencyKey: `campaign-delete:${campaign._id.toString()}:${contribution._id.toString()}`,
  balanceAfter,
  createdAt: now,
  metadata: {
    campaignTitle: campaign.title,
    contributionId: contribution._id.toString(),
    previousContributionStatus: contribution.status,
  },
});

const createCampaignDecisionNotification = ({ campaign, decision, reason, now }) => ({
  type: "campaign_decision",
  message:
    decision === "approved"
      ? `Your campaign "${campaign.title}" was approved by FundBloom admin.`
      : `Your campaign "${campaign.title}" was rejected by FundBloom admin.`,
  toUserId: campaign.creatorId,
  toEmail: campaign.creatorEmail,
  actionRoute: "/dashboard/creator/campaigns",
  relatedEntity: { type: "campaign", id: campaign._id },
  eventKey: `campaign-decision:${campaign._id.toString()}:${decision}`,
  readAt: null,
  time: now,
  metadata: {
    decision,
    reason: reason ?? "",
  },
});

const createContributionNotification = ({ contribution, campaign, now }) => ({
  type: "contribution_created",
  message: `${contribution.supporterName} contributed ${contribution.amount} credits to "${campaign.title}".`,
  toUserId: campaign.creatorId,
  toEmail: campaign.creatorEmail,
  actionRoute: "/dashboard/creator",
  relatedEntity: { type: "contribution", id: contribution._id },
  eventKey: `contribution-created:${contribution._id.toString()}`,
  readAt: null,
  time: now,
  metadata: {
    campaignId: campaign._id.toString(),
    campaignTitle: campaign.title,
    amount: contribution.amount,
    supporterName: contribution.supporterName,
  },
});

const createContributionDebitLedger = ({ supporter, contribution, campaign, now, balanceAfter }) => ({
  userId: supporter._id,
  type: "contribution_debit",
  amount: -contribution.amount,
  balanceType: "credits",
  referenceType: "contribution",
  referenceId: contribution._id.toString(),
  idempotencyKey: `contribution:${supporter._id.toString()}:${contribution.idempotencyKey}`,
  balanceAfter,
  createdAt: now,
  metadata: {
    campaignId: campaign._id.toString(),
    campaignTitle: campaign.title,
  },
});

const createContributionDecisionNotification = ({ contribution, decision, now }) => ({
  type: "contribution_decision",
  message:
    decision === "approved"
      ? `Your contribution of ${contribution.amount} credits to "${contribution.campaignTitle}" was approved by ${contribution.creatorName}.`
      : `Your contribution of ${contribution.amount} credits to "${contribution.campaignTitle}" was rejected by ${contribution.creatorName} and refunded.`,
  toUserId: contribution.supporterId,
  toEmail: contribution.supporterEmail,
  actionRoute: "/dashboard/supporter/contributions",
  relatedEntity: { type: "contribution", id: contribution._id },
  eventKey: `contribution-decision:${contribution._id.toString()}:${decision}`,
  readAt: null,
  time: now,
  metadata: {
    decision,
    campaignId: contribution.campaignId.toString(),
    campaignTitle: contribution.campaignTitle,
    amount: contribution.amount,
  },
});

const createContributionApprovalLedger = ({ creator, contribution, now, balanceAfter, idempotencyKey }) => ({
  userId: creator._id,
  type: "creator_raise",
  amount: contribution.amount,
  balanceType: "creator_withdrawable",
  referenceType: "contribution",
  referenceId: contribution._id.toString(),
  idempotencyKey: `contribution-approval:${contribution._id.toString()}:${idempotencyKey}`,
  balanceAfter,
  createdAt: now,
  metadata: {
    campaignId: contribution.campaignId.toString(),
    campaignTitle: contribution.campaignTitle,
    supporterName: contribution.supporterName,
  },
});

const createContributionRejectionLedger = ({ supporter, contribution, now, balanceAfter, idempotencyKey }) => ({
  userId: supporter._id,
  type: "contribution_refund",
  amount: contribution.amount,
  balanceType: "credits",
  referenceType: "contribution",
  referenceId: contribution._id.toString(),
  idempotencyKey: `contribution-rejection:${contribution._id.toString()}:${idempotencyKey}`,
  balanceAfter,
  createdAt: now,
  metadata: {
    campaignId: contribution.campaignId.toString(),
    campaignTitle: contribution.campaignTitle,
    previousContributionStatus: contribution.status,
  },
});

const assertSameContributionPayload = ({ existing, campaignId, input }) => {
  const sameCampaign = existing.campaignId?.toString?.() === objectIdOrString(campaignId)?.toString?.();
  const sameAmount = existing.amount === input.amount;
  const sameMessage = (existing.message ?? "") === (input.message ?? "");

  if (!sameCampaign || !sameAmount || !sameMessage) {
    throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different request.");
  }
};

const getCampaignForAdmin = async ({ campaigns, campaignId, session }) => {
  const campaign = await campaigns.findOne(
    { _id: objectIdOrString(campaignId) },
    session ? { session } : undefined,
  );

  if (!campaign) {
    throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
  }

  if (campaign.status === "deleted") {
    throw new ApiError(409, "CAMPAIGN_ALREADY_DELETED", "Campaign has already been deleted.");
  }

  return campaign;
};

const softDeleteCampaignWithRefunds = async ({ database, campaign, now, moderation, session }) => {
  const sessionOption = session ? { session } : undefined;
  const campaigns = database.collection("campaigns");
  const contributions = database.collection("contributions");
  const users = database.collection("users");
  const ledger = database.collection("creditTransactions");
  const refundableContributions = await contributions
    .find(
      {
        campaignId: campaign._id,
        status: { $in: REFUNDABLE_CONTRIBUTION_STATUSES },
      },
      sessionOption,
    )
    .toArray();

  let refundedCredits = 0;

  for (const contribution of refundableContributions) {
    const contributionUpdate = await contributions.updateOne(
      { _id: contribution._id, status: contribution.status },
      {
        $set: {
          status: "refunded",
          refundedAt: now,
          updatedAt: now,
        },
      },
      sessionOption,
    );

    if (contributionUpdate.matchedCount === 0) {
      continue;
    }

    const supporter = await users.findOne({ _id: contribution.supporterId }, sessionOption);

    if (!supporter) {
      throw new ApiError(409, "REFUND_SUPPORTER_MISSING", "A supporter account required for refund was not found.");
    }

    const balanceAfter = (supporter.credits ?? 0) + contribution.amount;

    await users.updateOne(
      { _id: contribution.supporterId },
      {
        $inc: { credits: contribution.amount },
        $set: { updatedAt: now },
      },
      sessionOption,
    );
    await ledger.insertOne(createRefundLedger({ contribution, campaign, now, balanceAfter }), sessionOption);

    refundedCredits += contribution.amount;
  }

  if (refundedCredits > 0) {
    await users.updateOne(
      { _id: campaign.creatorId },
      {
        $inc: { "creatorBalance.lifetimeRaised": -refundedCredits },
        $set: { updatedAt: now },
      },
      sessionOption,
    );
  }

  const update = {
    $set: {
      status: "deleted",
      deletedAt: now,
      updatedAt: now,
    },
  };

  if (moderation) {
    update.$set.moderation = moderation;
  }

  const campaignUpdate = await campaigns.updateOne(
    { _id: campaign._id, status: { $ne: "deleted" } },
    update,
    sessionOption,
  );

  if (campaignUpdate.matchedCount === 0) {
    throw new ApiError(409, "CAMPAIGN_ALREADY_DELETED", "Campaign has already been deleted.");
  }

  return {
    campaign: toCreatorCampaign({
      ...campaign,
      status: "deleted",
      deletedAt: now,
      updatedAt: now,
      ...(moderation ? { moderation } : {}),
    }),
    refund: {
      refundedContributions: refundableContributions.length,
      refundedCredits,
    },
  };
};

export const createCampaign = async ({ database, user, input, now = new Date() }) => {
  assertFutureDeadline(input.deadline, now);

  const campaign = {
    title: input.title,
    story: input.story,
    category: input.category,
    fundingGoal: input.fundingGoal,
    minimumContribution: input.minimumContribution,
    deadline: input.deadline,
    rewardInfo: input.rewardInfo,
    imageUrl: input.imageUrl,
    creatorId: objectIdOrString(user.id),
    creatorName: user.displayName,
    creatorEmail: user.email,
    amountRaised: 0,
    status: "pending",
    moderation: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  const result = await database.collection("campaigns").insertOne(campaign);

  return toCreatorCampaign({ ...campaign, _id: result.insertedId });
};

export const listCreatorCampaigns = async ({ database, user, page = 1, limit = 10 }) => {
  const campaigns = database.collection("campaigns");
  const filter = {
    creatorId: objectIdOrString(user.id),
    status: { $ne: "deleted" },
  };
  const skip = (page - 1) * limit;

  const [records, totalItems] = await Promise.all([
    campaigns.find(filter).sort({ deadline: -1, createdAt: -1 }).skip(skip).limit(limit).toArray(),
    campaigns.countDocuments(filter),
  ]);
  const totalPages = Math.ceil(totalItems / limit);

  return {
    data: records.map(toCreatorCampaign),
    meta: {
      page,
      limit,
      totalItems,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
};

export const updateCreatorCampaign = async ({ database, user, campaignId, input, now = new Date() }) => {
  const campaigns = database.collection("campaigns");
  const campaign = await getOwnedCampaign({ campaigns, campaignId, user });
  const update = {
    $set: {
      ...input,
      updatedAt: now,
    },
  };

  await campaigns.updateOne({ _id: campaign._id }, update);

  return toCreatorCampaign({
    ...campaign,
    ...input,
    updatedAt: now,
  });
};

export const deleteCreatorCampaign = async ({ database, user, campaignId, now = new Date() }) =>
  runInTransaction(database, async (session) => {
    const campaigns = database.collection("campaigns");
    const campaign = await getOwnedCampaign({ campaigns, campaignId, user, session });
    return softDeleteCampaignWithRefunds({ database, campaign, now, session });
  });

export const createContribution = async ({ database, user, campaignId, input, idempotencyKey, now = new Date() }) =>
  runInTransaction(database, async (session) => {
    const sessionOption = session ? { session } : undefined;
    const campaigns = database.collection("campaigns");
    const contributions = database.collection("contributions");
    const users = database.collection("users");
    const ledger = database.collection("creditTransactions");
    const notifications = database.collection("notifications");
    const supporterId = objectIdOrString(user.id);
    const campaignObjectId = objectIdOrString(campaignId);
    const existing = await contributions.findOne(
      {
        supporterId,
        idempotencyKey,
      },
      sessionOption,
    );

    if (existing) {
      assertSameContributionPayload({ existing, campaignId, input });
      return { contribution: toContribution(existing), replayed: true };
    }

    const campaign = await campaigns.findOne(
      {
        _id: campaignObjectId,
        status: "approved",
        deadline: { $gte: now },
      },
      sessionOption,
    );

    if (!campaign) {
      throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
    }

    if (input.amount < campaign.minimumContribution) {
      throw new ApiError(
        400,
        "CONTRIBUTION_BELOW_MINIMUM",
        `Contribution must be at least ${campaign.minimumContribution} credits.`,
      );
    }

    const pendingContributions = await contributions
      .find(
        {
          campaignId: campaign._id,
          status: "pending",
        },
        sessionOption,
      )
      .toArray();
    const pendingReservedCredits = pendingContributions.reduce(
      (total, contribution) => total + (contribution.amount ?? 0),
      0,
    );
    const remainingCredits = campaign.fundingGoal - (campaign.amountRaised ?? 0) - pendingReservedCredits;

    if (remainingCredits <= 0) {
      throw new ApiError(409, "CAMPAIGN_GOAL_REACHED", "This campaign has no remaining funding capacity.");
    }

    if (input.amount > remainingCredits) {
      throw new ApiError(
        409,
        "CONTRIBUTION_EXCEEDS_REMAINING_GOAL",
        `Contribution cannot exceed the remaining ${remainingCredits} credits for this campaign.`,
      );
    }

    const supporter = await users.findOne(
      {
        _id: supporterId,
        role: "supporter",
        status: "active",
      },
      sessionOption,
    );

    if (!supporter) {
      throw new ApiError(401, "USER_NOT_ACTIVE", "Authenticated supporter account is not active.");
    }

    const startingCredits = supporter.credits ?? 0;

    if (startingCredits < input.amount) {
      throw new ApiError(409, "INSUFFICIENT_CREDITS", "Supporter does not have enough credits.");
    }

    const debitResult = await users.updateOne(
      {
        _id: supporter._id,
        status: "active",
        credits: { $gte: input.amount },
      },
      {
        $inc: { credits: -input.amount },
        $set: { updatedAt: now },
      },
      sessionOption,
    );

    if (debitResult.matchedCount === 0) {
      throw new ApiError(409, "INSUFFICIENT_CREDITS", "Supporter does not have enough credits.");
    }

    const contribution = {
      campaignId: campaign._id,
      campaignTitle: campaign.title,
      amount: input.amount,
      supporterId: supporter._id,
      supporterEmail: supporter.email,
      supporterName: supporter.displayName,
      creatorId: campaign.creatorId,
      creatorEmail: campaign.creatorEmail,
      creatorName: campaign.creatorName,
      message: input.message ?? "",
      status: "pending",
      idempotencyKey,
      createdAt: now,
      decidedAt: null,
      decidedBy: null,
      refundedAt: null,
    };
    const insertResult = await contributions.insertOne(contribution, sessionOption);
    const insertedContribution = { ...contribution, _id: insertResult.insertedId };
    const balanceAfter = startingCredits - input.amount;

    await ledger.insertOne(
      createContributionDebitLedger({
        supporter,
        contribution: insertedContribution,
        campaign,
        now,
        balanceAfter,
      }),
      sessionOption,
    );
    await notifications.insertOne(
      createContributionNotification({
        contribution: insertedContribution,
        campaign,
        now,
      }),
      sessionOption,
    );

    return { contribution: toContribution(insertedContribution), replayed: false };
  });

export const listCreatorPendingContributions = async ({ database, user, page = 1, limit = 10 }) => {
  const contributions = database.collection("contributions");
  const filter = {
    creatorId: objectIdOrString(user.id),
    status: "pending",
  };
  const skip = (page - 1) * limit;

  const [records, totalItems] = await Promise.all([
    contributions.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    contributions.countDocuments(filter),
  ]);
  const totalPages = Math.ceil(totalItems / limit);

  return {
    data: records.map(toContribution),
    meta: {
      page,
      limit,
      totalItems,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
};

export const getCreatorContribution = async ({ database, user, contributionId }) => {
  const contribution = await database.collection("contributions").findOne({
    _id: objectIdOrString(contributionId),
    creatorId: objectIdOrString(user.id),
  });

  if (!contribution) {
    throw new ApiError(404, "CONTRIBUTION_NOT_FOUND", "Contribution was not found.");
  }

  return toContribution(contribution);
};

export const decideContributionAsCreator = async ({
  database,
  user,
  contributionId,
  decision,
  idempotencyKey,
  now = new Date(),
}) =>
  runInTransaction(database, async (session) => {
    const sessionOption = session ? { session } : undefined;
    const campaigns = database.collection("campaigns");
    const contributions = database.collection("contributions");
    const users = database.collection("users");
    const ledger = database.collection("creditTransactions");
    const notifications = database.collection("notifications");
    const creatorId = objectIdOrString(user.id);
    const contributionObjectId = objectIdOrString(contributionId);
    const contribution = await contributions.findOne(
      {
        _id: contributionObjectId,
        creatorId,
      },
      sessionOption,
    );

    if (!contribution) {
      throw new ApiError(404, "CONTRIBUTION_NOT_FOUND", "Contribution was not found.");
    }

    if (contribution.status !== "pending") {
      const isReplay =
        contribution.decisionIdempotencyKey === idempotencyKey && contribution.status === decision;

      if (isReplay) {
        return { contribution: toContribution(contribution), replayed: true };
      }

      throw new ApiError(
        409,
        "CONTRIBUTION_DECISION_CONFLICT",
        "Only pending contributions can be approved or rejected.",
      );
    }

    const campaign = await campaigns.findOne(
      {
        _id: contribution.campaignId,
        creatorId,
        status: { $ne: "deleted" },
      },
      sessionOption,
    );

    if (!campaign) {
      throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
    }

    const decisionFields = {
      status: decision,
      decidedAt: now,
      decidedBy: creatorId,
      decisionIdempotencyKey: idempotencyKey,
      updatedAt: now,
      ...(decision === "rejected" ? { refundedAt: now } : {}),
    };

    const contributionUpdate = await contributions.updateOne(
      {
        _id: contribution._id,
        creatorId,
        status: "pending",
      },
      {
        $set: decisionFields,
      },
      sessionOption,
    );

    if (contributionUpdate.matchedCount === 0) {
      throw new ApiError(
        409,
        "CONTRIBUTION_DECISION_CONFLICT",
        "Only pending contributions can be approved or rejected.",
      );
    }

    if (decision === "approved") {
      const creator = await users.findOne(
        {
          _id: creatorId,
          role: "creator",
          status: "active",
        },
        sessionOption,
      );

      if (!creator) {
        throw new ApiError(409, "CREATOR_ACCOUNT_MISSING", "Creator account required for approval was not found.");
      }

      const campaignUpdate = await campaigns.updateOne(
        { _id: campaign._id, creatorId, status: { $ne: "deleted" } },
        {
          $inc: { amountRaised: contribution.amount },
          $set: { updatedAt: now },
        },
        sessionOption,
      );

      if (campaignUpdate.matchedCount === 0) {
        throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
      }

      const creatorBalanceAfter = (creator.creatorBalance?.lifetimeRaised ?? 0) + contribution.amount;

      await users.updateOne(
        { _id: creator._id, role: "creator", status: "active" },
        {
          $inc: { "creatorBalance.lifetimeRaised": contribution.amount },
          $set: { updatedAt: now },
        },
        sessionOption,
      );
      await ledger.insertOne(
        createContributionApprovalLedger({
          creator,
          contribution,
          now,
          balanceAfter: creatorBalanceAfter,
          idempotencyKey,
        }),
        sessionOption,
      );
    } else {
      const supporter = await users.findOne({ _id: contribution.supporterId }, sessionOption);

      if (!supporter) {
        throw new ApiError(409, "REFUND_SUPPORTER_MISSING", "A supporter account required for refund was not found.");
      }

      const supporterBalanceAfter = (supporter.credits ?? 0) + contribution.amount;

      await users.updateOne(
        { _id: supporter._id },
        {
          $inc: { credits: contribution.amount },
          $set: { updatedAt: now },
        },
        sessionOption,
      );
      await ledger.insertOne(
        createContributionRejectionLedger({
          supporter,
          contribution,
          now,
          balanceAfter: supporterBalanceAfter,
          idempotencyKey,
        }),
        sessionOption,
      );
    }

    const decidedContribution = {
      ...contribution,
      ...decisionFields,
    };

    await notifications.insertOne(
      createContributionDecisionNotification({
        contribution: decidedContribution,
        decision,
        now,
      }),
      sessionOption,
    );

    return { contribution: toContribution(decidedContribution), replayed: false };
  });

export const listAdminCampaigns = async ({ database, status = "pending", search, page = 1, limit = 10 }) => {
  const campaigns = database.collection("campaigns");
  const filter = {};
  const skip = (page - 1) * limit;

  if (status && status !== "all") {
    filter.status = status;
  }

  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ title: pattern }, { creatorName: pattern }, { creatorEmail: pattern }, { category: pattern }];
  }

  const [records, totalItems] = await Promise.all([
    campaigns.find(filter).sort({ createdAt: -1, deadline: -1 }).skip(skip).limit(limit).toArray(),
    campaigns.countDocuments(filter),
  ]);
  const totalPages = Math.ceil(totalItems / limit);

  return {
    data: records.map(toAdminCampaign),
    meta: {
      page,
      limit,
      totalItems,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
};

export const decideCampaignAsAdmin = async ({ database, admin, campaignId, input, now = new Date() }) =>
  runInTransaction(database, async (session) => {
    const sessionOption = session ? { session } : undefined;
    const campaigns = database.collection("campaigns");
    const notifications = database.collection("notifications");
    const campaign = await campaigns.findOne({ _id: objectIdOrString(campaignId) }, sessionOption);

    if (!campaign) {
      throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
    }

    if (campaign.status !== "pending") {
      throw new ApiError(409, "CAMPAIGN_DECISION_CONFLICT", "Only pending campaigns can be approved or rejected.");
    }

    const moderation = {
      action: input.decision,
      decidedBy: objectIdOrString(admin.id),
      decidedAt: now,
      reason: input.reason ?? "",
    };
    const campaignUpdate = await campaigns.updateOne(
      { _id: campaign._id, status: "pending" },
      {
        $set: {
          status: input.decision,
          moderation,
          updatedAt: now,
        },
      },
      sessionOption,
    );

    if (campaignUpdate.matchedCount === 0) {
      throw new ApiError(409, "CAMPAIGN_DECISION_CONFLICT", "Only pending campaigns can be approved or rejected.");
    }

    await notifications.insertOne(
      createCampaignDecisionNotification({
        campaign,
        decision: input.decision,
        reason: input.reason,
        now,
      }),
      sessionOption,
    );

    return toAdminCampaign({
      ...campaign,
      status: input.decision,
      moderation,
      updatedAt: now,
    });
  });

export const suspendCampaignAsAdmin = async ({ database, admin, campaignId, reason, now = new Date() }) =>
  runInTransaction(database, async (session) => {
    const sessionOption = session ? { session } : undefined;
    const campaigns = database.collection("campaigns");
    const campaign = await getCampaignForAdmin({ campaigns, campaignId, session });

    if (campaign.status === "suspended") {
      throw new ApiError(409, "CAMPAIGN_ALREADY_SUSPENDED", "Campaign is already suspended.");
    }

    const moderation = {
      action: "suspended",
      decidedBy: objectIdOrString(admin.id),
      decidedAt: now,
      reason,
    };
    const campaignUpdate = await campaigns.updateOne(
      { _id: campaign._id, status: { $ne: "deleted" } },
      {
        $set: {
          status: "suspended",
          moderation,
          updatedAt: now,
        },
      },
      sessionOption,
    );

    if (campaignUpdate.matchedCount === 0) {
      throw new ApiError(409, "CAMPAIGN_ALREADY_DELETED", "Campaign has already been deleted.");
    }

    return toAdminCampaign({
      ...campaign,
      status: "suspended",
      moderation,
      updatedAt: now,
    });
  });

export const deleteCampaignAsAdmin = async ({ database, admin, campaignId, reason, now = new Date() }) =>
  runInTransaction(database, async (session) => {
    const campaigns = database.collection("campaigns");
    const campaign = await getCampaignForAdmin({ campaigns, campaignId, session });
    const moderation = {
      action: "deleted",
      decidedBy: objectIdOrString(admin.id),
      decidedAt: now,
      reason: reason ?? "",
    };

    const result = await softDeleteCampaignWithRefunds({ database, campaign, now, moderation, session });

    return {
      ...result,
      campaign: toAdminCampaign({
        ...campaign,
        status: "deleted",
        moderation,
        deletedAt: now,
        updatedAt: now,
      }),
    };
  });

export const listPublicCampaigns = async ({ database, page = 1, limit = 10, filters = {}, now = new Date() }) => {
  const campaigns = database.collection("campaigns");
  const query = createApprovedActiveCampaignFilter({ now, ...filters });
  const skip = (page - 1) * limit;

  const [records, totalItems] = await Promise.all([
    campaigns
      .find(query)
      .sort({ createdAt: -1, deadline: 1 })
      .skip(skip)
      .limit(limit)
      .project({
        _id: 1,
        title: 1,
        category: 1,
        imageUrl: 1,
        creatorName: 1,
        fundingGoal: 1,
        amountRaised: 1,
        deadline: 1,
      })
      .toArray(),
    campaigns.countDocuments(query),
  ]);
  const totalPages = Math.ceil(totalItems / limit);

  return {
    data: records.map(toPublicCampaignSummary),
    meta: {
      page,
      limit,
      totalItems,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
};

export const getPublicCampaignDetail = async ({ database, campaignId, now = new Date() }) => {
  const campaigns = database.collection("campaigns");
  const campaign = await campaigns.findOne({
    _id: objectIdOrString(campaignId),
    status: "approved",
    deadline: { $gte: now },
  });

  if (!campaign) {
    throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
  }

  return toPublicCampaignDetail(campaign);
};

export const getTopFundedCampaigns = async ({ database }) => {
  const campaigns = database.collection("campaigns");
  const approvedFilter = { status: "approved" };

  const topFundedCampaigns = await campaigns
    .find(approvedFilter)
    .sort({ amountRaised: -1, createdAt: -1 })
    .limit(TOP_FUNDED_LIMIT)
    .project({
      _id: 1,
      title: 1,
      category: 1,
      imageUrl: 1,
      creatorName: 1,
      fundingGoal: 1,
      amountRaised: 1,
      deadline: 1,
    })
    .toArray();

  const impactRows = await campaigns
    .aggregate([
      { $match: approvedFilter },
      {
        $group: {
          _id: null,
          approvedCampaigns: { $sum: 1 },
          totalRaisedCredits: { $sum: { $ifNull: ["$amountRaised", 0] } },
          totalFundingGoal: { $sum: { $ifNull: ["$fundingGoal", 0] } },
          categories: { $addToSet: "$category" },
        },
      },
      {
        $project: {
          _id: 0,
          approvedCampaigns: 1,
          totalRaisedCredits: 1,
          totalFundingGoal: 1,
          categoriesCount: { $size: "$categories" },
        },
      },
    ])
    .toArray();

  const impact = impactRows[0] ?? {
    approvedCampaigns: 0,
    totalRaisedCredits: 0,
    totalFundingGoal: 0,
    categoriesCount: 0,
  };

  return {
    campaigns: topFundedCampaigns.map(toPublicCampaignSummary),
    impact,
  };
};
