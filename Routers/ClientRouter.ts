import { Router } from "express";
import { updateClientAddressController, addClientDetailsController, updateClientNumberController, clientDetails, checkClientSetupStatus, upsertClientAddressController, getClientAddressByIdController } from "../Controllers/Client.controller";
import { authMiddleware } from "../Middleware/AuthMiddleware";


const clientRouter = Router();

clientRouter.use(authMiddleware);

clientRouter.post("/addClientDetails", addClientDetailsController);
clientRouter.patch("/updateClientAddress", updateClientAddressController);
clientRouter.patch("/updateClientNumber", updateClientNumberController);
clientRouter.get("/clientDetails", clientDetails);
clientRouter.get("/checkSetupStatus", checkClientSetupStatus);
clientRouter.post("/upsertAddress", upsertClientAddressController);
clientRouter.get("/addresses/:addressId", getClientAddressByIdController);
clientRouter.patch("/addresses/:addressId", upsertClientAddressController);
clientRouter.post("/addresses", upsertClientAddressController);

export default clientRouter;