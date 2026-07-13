import { getDatabase } from "../config/database.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { createCampaignReport, listReports, resolveReport } from "../services/report.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

const getRequestDatabase = (request) => (request.app.locals.getDatabase ?? getDatabase)();

export const createSupporterReport = asyncHandler(async (request, response) => {
  const report = await createCampaignReport({
    database: getRequestDatabase(request),
    user: request.user,
    campaignId: request.validated.params.campaignId,
    reason: request.validated.body.reason,
  });
  sendSuccess(response, 201, { report });
});

export const listAdminReports = asyncHandler(async (request, response) => {
  const { status, page, limit } = request.validated.query;
  const result = await listReports({ database: getRequestDatabase(request), status, page, limit });
  sendSuccess(response, 200, { reports: result.reports }, result.meta);
});

export const resolveAdminReport = asyncHandler(async (request, response) => {
  const report = await resolveReport({
    database: getRequestDatabase(request),
    admin: request.user,
    reportId: request.validated.params.reportId,
    action: request.validated.body.action,
    reason: request.validated.body.reason,
  });
  sendSuccess(response, 200, { report });
});
