import { Router } from "express";

import {
  listUserNotifications,
  readAllUserNotifications,
  readUserNotification,
} from "../controllers/notification.controller.js";
import { loadActiveUser, verifyAccessToken } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { listNotificationsSchema, notificationIdSchema } from "../validators/notification.validation.js";

export const notificationRoutes = Router();

notificationRoutes.use(verifyAccessToken, loadActiveUser);
notificationRoutes.get("/", validateRequest(listNotificationsSchema), listUserNotifications);
notificationRoutes.patch("/read-all", readAllUserNotifications);
notificationRoutes.patch("/:notificationId/read", validateRequest(notificationIdSchema), readUserNotification);
