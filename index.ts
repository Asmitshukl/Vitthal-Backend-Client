import cookieParser from 'cookie-parser';
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import pool from './DbConnect';
import { ensureMarketplaceSchema } from './DbSetup';
import productRouter from './Routers/Product.router';
import clientRouter from './Routers/ClientRouter';
import checkoutRouter from './Routers/Checkout.Router';
import authRouter from './Routers/Auth.router';
import vendorsRouter from './Routers/Vendors.Router';
import cartRouter from './Routers/Cart.router';
import wishlistRouter from './Routers/Wishlist.router';
import orderRouter from './Routers/Order.router';
import reviewRouter from './Routers/Review.router';
import quotationRouter from './Routers/Quotation.router';
import { startAbandonedReminderJob } from './jobs/abandonedReminder.job';

dotenv.config();

// Create an Express application
const app = express();
const PORT = 9000;


//cors configuration
const allowedOrigins = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:4000',
    'http://localhost:4001',
    'http://192.168.29.150:4000',
    'http://192.168.1.11:3000',
    'http://192.168.1.11:3001',
    'https://vitthal-vendor-frontend.vercel.app',
    'https://vitthal-frontend.vercel.app'
]);

app.use("/", cors({
    origin(origin, callback) {
        if (!origin) {
            callback(null, true);
            return;
        }

        const isLocalhost = /^http:\/\/localhost:\d+$/.test(origin);
        const isLanIp = /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin);
        const isVercelPreview = /^https:\/\/.*\.vercel\.app$/.test(origin);

        if (allowedOrigins.has(origin) || isLocalhost || isLanIp || isVercelPreview) {
            callback(null, true);
            return;
        }
        console.log("Blocked CORS origin:", origin);

        return callback(null, false);
    },
    credentials: true,
}));

//using Middleware
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//database connection
pool.connect()
    .then(() => console.log('Connected to the database successfully!'))
    .catch((err) => console.error('Database connection error:', err.stack));

void ensureMarketplaceSchema().catch((error) => {
    console.error("Failed to ensure marketplace schema:", error);
});

startAbandonedReminderJob();

// Define routes
app.use("/api/auth", authRouter);
app.use("/api/products", productRouter);
app.use("/api/vendors", vendorsRouter);
app.use("/api/client", clientRouter);
app.use("/api/cart", cartRouter);
app.use("/api/wishlist", wishlistRouter);
app.use("/api/checkout", checkoutRouter);
app.use("/api/orders", orderRouter);
app.use("/api/reviews", reviewRouter);
app.use("/api/quotations", quotationRouter);

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}🚀🚀`);
})
