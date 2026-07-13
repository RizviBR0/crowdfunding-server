import { getDatabase } from "../config/database.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notification.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

const getRequestDatabase = (request) => (request.app.locals.getDatabase ?? getDatabase)();

export const listUserNotifications = asyncHandler(async (request, response) => {
  const { page, limit } = request.validated.query;
  const result = await listNotifications({ database: getRequestDatabase(request), userId: request.user.id, page, limit });
  sendSuccess(response, 200, { notifications: result.notifications }, result.meta);
});

export const readUserNotification = asyncHandler(async (request, response) => {
  const result = await markNotificationRead({
    database: getRequestDatabase(request),
    userId: request.user.id,
    notificationId: request.validated.params.notificationId,
  });
  sendSuccess(response, 200, result);
});

export const readAllUserNotifications = asyncHandler(async (request, response) => {
  const result = await markAllNotificationsRead({ database: getRequestDatabase(request), userId: request.user.id });
  sendSuccess(response, 200, result);
});
