import { Router } from "express";

import { addVendorController, createVendorAddress, getVendorDetailsController, updateVendorAddress, updateVendorBasicDetailsController, checkVendorSetupStatus, completeVendorSetupController } from "../Controllers/Vendors.Controller";
import { getVendorDashboardController, getVendorAnalyticsController } from "../Controllers/VendorDashboard.Controller";

import { authMiddleware } from "../Middleware/AuthMiddleware";

const vendorsRouter = Router();
vendorsRouter.use(authMiddleware);

vendorsRouter.post("/createVendor", addVendorController);
vendorsRouter.post("/completeSetup", completeVendorSetupController);
vendorsRouter.put("/updateVendorBasicDetails", updateVendorBasicDetailsController);
vendorsRouter.post("/createVendorAddress", createVendorAddress);
vendorsRouter.put("/updateVendorAddress", updateVendorAddress);

vendorsRouter.get("/getVendorDetails", getVendorDetailsController);
vendorsRouter.get("/checkSetupStatus", checkVendorSetupStatus);
vendorsRouter.get("/dashboard", getVendorDashboardController);
vendorsRouter.get("/analytics", getVendorAnalyticsController);

// vendorsRouter.get("/product/:productId", getVendorProductByIdController);
// vendorsRouter.put("/product/:productId", updateVendorProductController);
// vendorsRouter.delete("/product/:productId", deleteVendorProductController);

export default vendorsRouter;