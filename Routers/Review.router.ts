import { Router } from "express";
import { authMiddleware } from "../Middleware/AuthMiddleware";
import { getReviewableOrderController, submitOrderReviewsController } from "../Controllers/Review.Controller";

const reviewRouter = Router();

reviewRouter.use(authMiddleware);

reviewRouter.get("/orders/:id", getReviewableOrderController);
reviewRouter.post("/orders/:id", submitOrderReviewsController);

export default reviewRouter;