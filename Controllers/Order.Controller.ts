import type { Request, Response } from "express";
import pool from "../DbConnect";

export const getOrdersController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;
    if (!authUser?.userId || !authUser?.role) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { userId, role } = authUser;
    if (role !== 'client') {
        return res.status(403).json({ message: "Only clients can view their orders" });
    }

    try {
        const query = `
            SELECT 
                o.id AS order_id,
                o.status,
                o.payment_status,
                o.total_amount,
                o.created_at,
                v.company_name AS vendor_name,
                (
                    SELECT json_agg(
                        json_build_object(
                            'product_id', oi.product_id,
                            'product_name', p.name,
                            'image_url', (SELECT image_url FROM products_images pi WHERE pi.product_id = p.id AND pi.is_primary = true LIMIT 1),
                            'quantity', oi.quantity,
                            'price', oi.price
                        )
                    )
                    FROM order_items oi
                    JOIN products p ON oi.product_id = p.id
                    WHERE oi.order_id = o.id
                ) AS items
            FROM orders o
            JOIN vendors v ON o.vendor_id = v.id
            WHERE o.user_id = $1
            ORDER BY o.created_at DESC;
        `;
        
        const result = await pool.query(query, [userId]);
        return res.status(200).json({ data: result.rows });
    } catch (error) {
        console.error("Error fetching orders:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
}

export const getVendorOrdersController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;
    console.log("Authenticated user in getVendorOrdersController:", authUser);  
    if (!authUser?.userId || !authUser?.role) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { userId, role } = authUser;
    if (role !== 'vendor') {
        return res.status(403).json({ message: "Only vendors can view their orders" });
    }

    try {
        // First get the vendor_id from the user_id
        const vendorQuery = `
            SELECT id FROM vendors WHERE user_id = $1;
        `;
        const vendorResult = await pool.query(vendorQuery, [userId]);
        
        if (vendorResult.rows.length === 0) {
            return res.status(404).json({ message: "Vendor not found" });
        }

        const vendorId = vendorResult.rows[0].id;

        // Fetch orders for this vendor
        const query = `
            SELECT 
                o.id AS order_id,
                o.status,
                o.payment_status,
                o.total_amount,
                o.created_at,
                o.address_line,
                o.city,
                o.state,
                o.pincode,
                u.name AS customer_name,
                u.email AS customer_email,
                c.phone AS customer_phone,
                (
                    SELECT json_agg(
                        json_build_object(
                            'product_id', oi.product_id,
                            'product_name', p.name,
                            'image_url', (SELECT image_url FROM products_images pi WHERE pi.product_id = p.id AND pi.is_primary = true LIMIT 1),
                            'quantity', oi.quantity,
                            'price', oi.price
                        )
                    )
                    FROM order_items oi
                    JOIN products p ON oi.product_id = p.id
                    WHERE oi.order_id = o.id
                ) AS items
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN client c ON u.id = c.user_id
            WHERE o.vendor_id = $1
            ORDER BY o.created_at DESC;
        `;
        
        const result = await pool.query(query, [vendorId]);
        return res.status(200).json({ data: result.rows });
    } catch (error) {
        console.error("Error fetching vendor orders:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
}

export const getVendorOrderByIdController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;
    if (!authUser?.userId || !authUser?.role) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { userId, role } = authUser;
    if (role !== 'vendor') {
        return res.status(403).json({ message: "Only vendors can view order details" });
    }

    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ message: "Order ID is required" });
    }

    try {
        // First get the vendor_id from the user_id
        const vendorQuery = `
            SELECT id FROM vendors WHERE user_id = $1;
        `;
        const vendorResult = await pool.query(vendorQuery, [userId]);
        
        if (vendorResult.rows.length === 0) {
            return res.status(404).json({ message: "Vendor not found" });
        }

        const vendorId = vendorResult.rows[0].id;

        // Fetch specific order for this vendor
        const query = `
            SELECT 
                o.id AS order_id,
                o.status,
                o.payment_status,
                o.total_amount,
                o.created_at,
                o.updated_at,
                o.address_line,
                o.city,
                o.state,
                o.country,
                o.pincode,
                o.latitude,
                o.langitude,
                u.name AS customer_name,
                u.email AS customer_email,
                c.phone AS customer_phone,
                (
                    SELECT json_agg(
                        json_build_object(
                            'product_id', oi.product_id,
                            'product_name', p.name,
                            'product_description', p.description,
                            'image_url', (SELECT image_url FROM products_images pi WHERE pi.product_id = p.id AND pi.is_primary = true LIMIT 1),
                            'quantity', oi.quantity,
                            'price', oi.price
                        ) ORDER BY oi.created_at
                    )
                    FROM order_items oi
                    JOIN products p ON oi.product_id = p.id
                    WHERE oi.order_id = o.id
                ) AS items
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN client c ON u.id = c.user_id
            WHERE o.id = $1 AND o.vendor_id = $2
            LIMIT 1;
        `;
        
        const result = await pool.query(query, [id, vendorId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Order not found or access denied" });
        }

        return res.status(200).json({ data: result.rows[0] });
    } catch (error) {
        console.error("Error fetching vendor order details:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
}
