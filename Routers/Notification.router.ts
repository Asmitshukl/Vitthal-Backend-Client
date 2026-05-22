import { Router } from "express";
import { authMiddleware } from "../Middleware/AuthMiddleware";
import {
    getNotificationsController,
    getUnreadCountController,
    markNotificationReadController,
    markAllNotificationsReadController,
} from "../Controllers/Notification.controller";

const notificationRouter = Router();

notificationRouter.use(authMiddleware);

notificationRouter.get("/", getNotificationsController);
notificationRouter.get("/unread-count", getUnreadCountController);
notificationRouter.put("/:id/read", markNotificationReadController);
notificationRouter.put("/read-all", markAllNotificationsReadController);

export default notificationRouter;
