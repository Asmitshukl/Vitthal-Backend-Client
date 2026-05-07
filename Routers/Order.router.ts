import { Router } from "express";
import { getOrdersController, getVendorOrdersController, getVendorOrderByIdController, getOrderTrackingController, updateOrderStatusController } from "../Controllers/Order.Controller";
import { authMiddleware } from "../Middleware/AuthMiddleware";
import { requireApprovedVendor } from "../Middleware/VendorApprovalMiddleware";

const orderRouter = Router();

orderRouter.use(authMiddleware);

orderRouter.get("/", getOrdersController);
orderRouter.get("/track/:id", getOrderTrackingController);
orderRouter.get("/vendor", requireApprovedVendor, getVendorOrdersController);
orderRouter.get("/vendor/:id", requireApprovedVendor, getVendorOrderByIdController);
orderRouter.put("/vendor/:id/status", requireApprovedVendor, updateOrderStatusController);

export default orderRouter;
