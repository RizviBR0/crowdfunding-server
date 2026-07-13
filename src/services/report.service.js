import { ObjectId } from "mongodb";
import { ApiError } from "../errors/ApiError.js";
import { deleteCampaignAsAdmin, suspendCampaignAsAdmin } from "./campaign.service.js";

const toObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : id);

const toReport = (report) => ({
  id: report._id?.toString?.() ?? report.id,
  campaignId: report.campaignId?.toString?.() ?? report.campaignId,
  campaignTitle: report.campaignTitle,
  reporterId: report.reporterId?.toString?.() ?? report.reporterId,
  reporterName: report.reporterName,
  reporterEmail: report.reporterEmail,
  reason: report.reason,
  status: report.status,
  createdAt: report.createdAt,
  resolvedAt: report.resolvedAt ?? null,
  resolution: report.resolution ?? null,
});

export const createCampaignReport = async ({ database, user, campaignId, reason, now = new Date() }) => {
  const campaigns = database.collection("campaigns");
  const campaign = await campaigns.findOne({ _id: toObjectId(campaignId), status: { $ne: "deleted" } });
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
  const reports = database.collection("reports");
  const existing = await reports.findOne({ campaignId: campaign._id, reporterId: toObjectId(user.id), status: "open" });
  if (existing) throw new ApiError(409, "REPORT_ALREADY_EXISTS", "You already have an open report for this campaign.");
  const report = {
    campaignId: campaign._id,
    campaignTitle: campaign.title,
    reporterId: toObjectId(user.id),
    reporterName: user.displayName,
    reporterEmail: user.email,
    reason,
    status: "open",
    createdAt: now,
    resolvedAt: null,
    resolution: null,
  };
  const result = await reports.insertOne(report);
  return toReport({ ...report, _id: result.insertedId });
};

export const listReports = async ({ database, status = "open", page = 1, limit = 20 }) => {
  const filter = status === "all" ? {} : { status };
  const reports = database.collection("reports");
  const [records, totalItems] = await Promise.all([
    reports.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    reports.countDocuments(filter),
  ]);
  const totalPages = Math.ceil(totalItems / limit);
  return { reports: records.map(toReport), meta: { page, limit, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 } };
};

export const resolveReport = async ({ database, admin, reportId, action, reason, now = new Date() }) => {
  const reports = database.collection("reports");
  const report = await reports.findOne({ _id: toObjectId(reportId), status: "open" });
  if (!report) throw new ApiError(404, "REPORT_NOT_FOUND", "Open report was not found.");

  if (action === "suspend") {
    await suspendCampaignAsAdmin({ database, admin, campaignId: report.campaignId.toString(), reason: reason || report.reason, now });
  } else if (action === "delete") {
    await deleteCampaignAsAdmin({ database, admin, campaignId: report.campaignId.toString(), reason: reason || report.reason, now });
  }

  const resolution = { action, reason: reason || report.reason, adminId: toObjectId(admin.id), adminName: admin.displayName };
  await reports.updateOne({ _id: report._id, status: "open" }, { $set: { status: "resolved", resolvedAt: now, resolution } });
  return toReport({ ...report, status: "resolved", resolvedAt: now, resolution });
};
