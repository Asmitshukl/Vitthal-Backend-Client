import type { Request, Response, NextFunction } from "express";
import { generateAccessToken, verifyToken } from "../helpers/jwt.helper";
import { COOKIE_OPTIONS } from "../shared/CokkieSetting.shared";

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    try {
        const requestFrom = req.headers["x-request-from"];

        if(requestFrom === "client"){
            const accessToken = req.cookies.clientAccessToken;
            const refreshToken = req.cookies.clientRefreshToken;
            return handleClientTokens(accessToken, refreshToken, req, res, next);
        }
        else if(requestFrom === "vendor"){
            const accessToken = req.cookies.vendorAccessToken;
            const refreshToken = req.cookies.vendorRefreshToken;
            return handleVendorTokens(accessToken, refreshToken, req, res, next);
        }
        else{
            return res.status(400).json({ message: "Bad Request! Missing or invalid 'x-request-from' header." });
        }
    
    } catch (error) {
        console.log("Error verifying tokens:", error);
        return res.status(401).json({ message: "Unauthorized! Failed to verify Tokens." });
    }
}

//helpers : 
const generateNewAccessToken = (refreshToken: string) => {
    try {
        const decoded = verifyToken(refreshToken, "refresh");
        const { userId, username, email, role } = decoded;
        const newAccessToken = generateAccessToken(userId, username, email, role);
        return newAccessToken;
    }
    catch (error) {
        console.error("Error generating new access token:", error);
        throw new Error("Failed to generate new access token");
    }
}


const handleClientTokens = (accessToken: string, refreshToken: string, req: Request, res: Response, next: NextFunction) => {
    try{
        if(accessToken){
            console.log("Access token found for client");
            const decoded = verifyToken(accessToken, "access");
            (req as any).user = decoded;
            return next();
        }

        if(refreshToken){
            console.log("Access Token is not there, then Refresh token found for client");
            const decoded = verifyToken(refreshToken, "refresh");
            const newAccessToken = generateNewAccessToken(refreshToken);
            res.cookie("clientAccessToken", newAccessToken, COOKIE_OPTIONS);
            (req as any).user = decoded;
            return next();
        }

        return res.status(401).json({ message: "Unauthorized! No valid tokens provided." });

    }
    catch(error){
        console.error("Error handling client tokens:", error);
        return res.status(401).json({ message: "Unauthorized! Failed to handle client tokens." });
    }
}

const handleVendorTokens = (accessToken: string, refreshToken: string, req: Request, res: Response, next: NextFunction) => {
    try{
        if(accessToken){
            const decoded = verifyToken(accessToken, "access");
            (req as any).user = decoded;
            return next();
        }

        if(refreshToken){
            const decoded = verifyToken(refreshToken, "refresh");
            const newAccessToken = generateNewAccessToken(refreshToken);
            res.cookie("vendorAccessToken", newAccessToken, COOKIE_OPTIONS);
            (req as any).user = decoded;
            return next();
        }

        return res.status(401).json({ message: "Unauthorized! No valid tokens provided." });

    }
    catch(error){
        console.error("Error handling vendor tokens:", error);
        return res.status(401).json({ message: "Unauthorized! Failed to handle vendor tokens." });
    }
}