import { getDatabase } from "../config/database.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { removeUser, listUsers, updateUserRole } from "../services/user.service.js";
import { sendSuccess } from "../utils/apiResponse.js";

const getRequestDatabase = (request) => (request.app.locals.getDatabase ?? getDatabase)();

export const listAdminUsers = asyncHandler(async (request, response) => {
  const { page, limit, search, role } = request.validated.query;
  const result = await listUsers({ database: getRequestDatabase(request), page, limit, search, role });
  sendSuccess(response, 200, { users: result.users }, result.meta);
});

export const updateAdminUserRole = asyncHandler(async (request, response) => {
  const user = await updateUserRole({ database: getRequestDatabase(request), userId: request.validated.params.userId, role: request.validated.body.role });
  sendSuccess(response, 200, { user });
});

export const removeAdminUser = asyncHandler(async (request, response) => {
  const result = await removeUser({ database: getRequestDatabase(request), adminId: request.user.id, userId: request.validated.params.userId });
  sendSuccess(response, 200, result);
});
