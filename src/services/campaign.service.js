const TOP_FUNDED_LIMIT = 6;

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
