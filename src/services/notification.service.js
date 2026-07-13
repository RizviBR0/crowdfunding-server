import { ObjectId } from "mongodb";

const toObjectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : id);

const toNotification = (notification) => ({
  id: notification._id?.toString?.() ?? notification.id,
  type: notification.type,
  message: notification.message,
  actionRoute: notification.actionRoute,
  relatedEntity: notification.relatedEntity ?? null,
  readAt: notification.readAt ?? null,
  time: notification.time ?? notification.createdAt,
  metadata: notification.metadata ?? {},
});

export const listNotifications = async ({ database, userId, page = 1, limit = 20 }) => {
  const filter = { toUserId: toObjectId(userId) };
  const collection = database.collection("notifications");
  const [records, totalItems] = await Promise.all([
    collection.find(filter).sort({ time: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    collection.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(totalItems / limit);
  return {
    notifications: records.map(toNotification),
    meta: { page, limit, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
};

export const markNotificationRead = async ({ database, userId, notificationId, now = new Date() }) => {
  const result = await database.collection("notifications").updateOne(
    { _id: toObjectId(notificationId), toUserId: toObjectId(userId) },
    { $set: { readAt: now } },
  );

  return { updated: result.matchedCount > 0 };
};

export const markAllNotificationsRead = async ({ database, userId, now = new Date() }) => {
  const result = await database.collection("notifications").updateMany(
    { toUserId: toObjectId(userId), readAt: null },
    { $set: { readAt: now } },
  );

  return { updatedCount: result.modifiedCount ?? result.matchedCount ?? 0 };
};
