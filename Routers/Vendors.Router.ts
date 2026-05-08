import { Router } from "express";

import { addVendorController, createVendorAddress, getVendorCategoriesController, getVendorDetailsController, updateVendorAddress, updateVendorBasicDetailsController, completeVendorSetupController, getVendorIdStatusController } from "../Controllers/Vendors.Controller";
import { getVendorDashboardController, getVendorAnalyticsController } from "../Controllers/VendorDashboard.Controller";

import { authMiddleware } from "../Middleware/AuthMiddleware";
import { requireApprovedVendor } from "../Middleware/VendorApprovalMiddleware";

const vendorsRouter = Router();
vendorsRouter.use(authMiddleware);

vendorsRouter.post("/createVendor", addVendorController);
vendorsRouter.post("/completeSetup", completeVendorSetupController);
vendorsRouter.put("/updateVendorBasicDetails", updateVendorBasicDetailsController);
vendorsRouter.post("/createVendorAddress", createVendorAddress);
vendorsRouter.put("/updateVendorAddress", updateVendorAddress);

vendorsRouter.get("/getVendorCategories", getVendorCategoriesController);
vendorsRouter.get("/getVendorDetails", getVendorDetailsController);
vendorsRouter.get("/vendorIdStatus", getVendorIdStatusController);
vendorsRouter.get("/dashboard", requireApprovedVendor, getVendorDashboardController);
vendorsRouter.get("/analytics", requireApprovedVendor, getVendorAnalyticsController);

export default vendorsRouter;