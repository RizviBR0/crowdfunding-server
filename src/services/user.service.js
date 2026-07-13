import { ObjectId } from "mongodb";
import { ApiError } from "../errors/ApiError.js";

const toObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : id);

const toAdminUser = (user) => ({
  id: user._id?.toString?.() ?? user.id,
  displayName: user.displayName,
  email: user.email,
  photoUrl: user.photoUrl ?? "",
  role: user.role,
  credits: user.credits ?? 0,
  creatorBalance: user.creatorBalance ?? null,
  status: user.status,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const listUsers = async ({ database, search, role, page = 1, limit = 20 }) => {
  const filter = {};
  if (role && role !== "all") filter.role = role;
  if (search) filter.$or = [{ displayName: new RegExp(search, "i") }, { email: new RegExp(search, "i") }];
  const collection = database.collection("users");
  const [records, totalItems] = await Promise.all([
    collection.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    collection.countDocuments(filter),
  ]);
  const totalPages = Math.ceil(totalItems / limit);
  return {
    users: records.map(toAdminUser),
    meta: { page, limit, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
};

export const updateUserRole = async ({ database, userId, role, now = new Date() }) => {
  const users = database.collection("users");
  const target = await users.findOne({ _id: toObjectId(userId) });
  if (!target) throw new ApiError(404, "USER_NOT_FOUND", "User was not found.");
  if (target.role !== role) {
    const [campaigns, contributions, withdrawals, payments] = await Promise.all([
      database.collection("campaigns").countDocuments({ creatorId: target._id, status: { $ne: "deleted" } }),
      database.collection("contributions").countDocuments({ $or: [{ supporterId: target._id }, { creatorId: target._id }] }),
      database.collection("withdrawals").countDocuments({ creatorId: target._id }),
      database.collection("payments").countDocuments({ userId: target._id }),
    ]);
    if (campaigns + contributions + withdrawals + payments > 0) {
      throw new ApiError(409, "USER_ROLE_CHANGE_BLOCKED", "Role changes are blocked while financial or campaign records exist.");
    }
  }
  await users.updateOne({ _id: target._id }, { $set: { role, updatedAt: now } });
  return toAdminUser({ ...target, role, updatedAt: now });
};

export const removeUser = async ({ database, adminId, userId }) => {
  const users = database.collection("users");
  const targetId = toObjectId(userId);
  if (targetId?.toString?.() === toObjectId(adminId)?.toString?.()) {
    throw new ApiError(409, "SELF_DELETE_FORBIDDEN", "Admins cannot remove their own account.");
  }
  const target = await users.findOne({ _id: targetId });
  if (!target) throw new ApiError(404, "USER_NOT_FOUND", "User was not found.");
  if (target.role === "admin" && (await users.countDocuments({ role: "admin", status: "active" })) <= 1) {
    throw new ApiError(409, "LAST_ADMIN_FORBIDDEN", "The last active admin cannot be removed.");
  }
  const [campaigns, contributions, withdrawals, payments] = await Promise.all([
    database.collection("campaigns").countDocuments({ creatorId: targetId }),
    database.collection("contributions").countDocuments({ $or: [{ supporterId: targetId }, { creatorId: targetId }] }),
    database.collection("withdrawals").countDocuments({ creatorId: targetId }),
    database.collection("payments").countDocuments({ userId: targetId }),
  ]);
  if (campaigns + contributions + withdrawals + payments > 0) {
    throw new ApiError(409, "USER_REMOVE_BLOCKED", "Remove financial or campaign records before removing this user.");
  }
  const result = await users.deleteOne({ _id: targetId });
  return { removed: result.deletedCount === 1, userId: userId.toString() };
};
