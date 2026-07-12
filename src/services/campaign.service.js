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
