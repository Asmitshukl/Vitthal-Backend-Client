import { Router } from "express";
import { authMiddleware } from "../Middleware/AuthMiddleware";
import {
    addWishlistItemController,
    clearWishlistController,
    getWishlistController,
    removeWishlistItemController
} from "../Controllers/Wishlist.Controller";

const wishlistRouter = Router();

wishlistRouter.get("/", authMiddleware, getWishlistController);
wishlistRouter.post("/", authMiddleware, addWishlistItemController);
wishlistRouter.delete("/item", authMiddleware, removeWishlistItemController);
wishlistRouter.delete("/", authMiddleware, clearWishlistController);

export default wishlistRouter;