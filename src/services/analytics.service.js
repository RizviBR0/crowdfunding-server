import { ObjectId } from "mongodb";

const toObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : id);

export const getCreatorAnalytics = async ({ database, creatorId }) => {
  const campaigns = await database.collection("campaigns").find({ creatorId: toObjectId(creatorId), status: { $ne: "deleted" } }).toArray();
  return {
    totalCampaigns: campaigns.length,
    activeCampaigns: campaigns.filter((campaign) => campaign.status === "approved" && new Date(campaign.deadline) >= new Date()).length,
    totalRaised: campaigns.filter((campaign) => campaign.status === "approved").reduce((sum, campaign) => sum + (campaign.amountRaised ?? 0), 0),
  };
};

export const getAdminAnalytics = async ({ database }) => {
  const [users, payments] = await Promise.all([
    database.collection("users").find({}).toArray(),
    database.collection("payments").find({ status: "paid" }).toArray(),
  ]);
  return {
    supporters: users.filter((user) => user.role === "supporter").length,
    creators: users.filter((user) => user.role === "creator").length,
    availableCredits: users.reduce((sum, user) => sum + (user.credits ?? 0), 0),
    totalPaymentsProcessed: payments.length,
  };
};
