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

export const updateOrderStatusController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;
    if (!authUser?.userId || !authUser?.role) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { userId, role } = authUser;
    if (role !== 'vendor') {
        return res.status(403).json({ message: "Only vendors can update order status" });
    }

    const { id } = req.params;
    const { status } = req.body;

    if (!id) {
        return res.status(400).json({ message: "Order ID is required" });
    }

    if (!status) {
        return res.status(400).json({ message: "Status is required" });
    }

    // Validate status
    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'handed_over', 'received', 'dispatched'];
    if (!validStatuses.includes(status.toLowerCase())) {
        return res.status(400).json({ message: "Invalid status" });
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

        // Check if order belongs to this vendor
        const orderCheckQuery = `
            SELECT id FROM orders WHERE id = $1 AND vendor_id = $2;
        `;
        const orderCheckResult = await pool.query(orderCheckQuery, [id, vendorId]);
        
        if (orderCheckResult.rows.length === 0) {
            return res.status(404).json({ message: "Order not found or access denied" });
        }

        // Update order status
        const updateQuery = `
            UPDATE orders 
            SET status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND vendor_id = $3
            RETURNING id, status, updated_at;
        `;
        
        const result = await pool.query(updateQuery, [status.toLowerCase(), id, vendorId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Failed to update order" });
        }

        // Create status history entry for every status change
        const statusHistoryQuery = `
            INSERT INTO order_status_history (order_id, status, note, created_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            RETURNING id;
        `;
        
        const statusNotes: Record<string, string> = {
            'pending': 'Order placed by customer',
            'processing': 'Order accepted and being processed by vendor',
            'shipped': 'Order shipped by vendor',
            'delivered': 'Order delivered to customer',
            'cancelled': 'Order cancelled by vendor'
        };
        
        await pool.query(statusHistoryQuery, [id, status.toLowerCase(), statusNotes[status.toLowerCase()] || `Status updated to ${status} by vendor`]);

        // Create fulfillment tracking entry for processing, shipped, and delivered statuses
        if (['processing', 'shipped', 'delivered'].includes(status.toLowerCase())) {
            const fulfillmentQuery = `
                INSERT INTO order_fulfillment_tracking (order_id, status, note, created_at)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                RETURNING id;
            `;
            
            const fulfillmentNotes: Record<string, string> = {
                'processing': 'Order accepted and processing started',
                'shipped': 'Order dispatched from fulfillment center',
                'delivered': 'Order successfully delivered to customer'
            };
            
            await pool.query(fulfillmentQuery, [id, status.toLowerCase(), fulfillmentNotes[status.toLowerCase()] || `Order ${status} by vendor`]);
        }

        return res.status(200).json({ 
            message: "Order status updated successfully",
            data: result.rows[0]
        });
    } catch (error) {
        console.error("Error updating order status:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
}

export const getOrderTrackingController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;
    if (!authUser?.userId || !authUser?.role) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { userId, role } = authUser;
    if (role !== 'client') {
        return res.status(403).json({ message: "Only clients can track orders" });
    }

    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ message: "Order ID is required" });
    }

    try {
        // Fetch order details ensuring it belongs to this user
        const orderQuery = `
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
                o.order_reference,
                o.order_notes,
                v.company_name AS vendor_name,
                v.id AS vendor_id
            FROM orders o
            JOIN vendors v ON o.vendor_id = v.id
            WHERE o.id = $1 AND o.user_id = $2
            LIMIT 1;
        `;
        const orderResult = await pool.query(orderQuery, [id, userId]);

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ message: "Order not found or access denied" });
        }

        const order = orderResult.rows[0];

        // Fetch order items
        const itemsQuery = `
            SELECT 
                oi.product_id,
                p.name AS product_name,
                p.description AS product_description,
                (SELECT image_url FROM products_images pi WHERE pi.product_id = p.id AND pi.is_primary = true LIMIT 1) AS image_url,
                oi.quantity,
                oi.price
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = $1
            ORDER BY oi.created_at;
        `;
        const itemsResult = await pool.query(itemsQuery, [id]);

        // Fetch order status history
        const statusHistoryQuery = `
            SELECT 
                osh.id,
                osh.status,
                osh.note,
                osh.created_at
            FROM order_status_history osh
            WHERE osh.order_id = $1
            ORDER BY osh.created_at ASC;
        `;
        const statusHistoryResult = await pool.query(statusHistoryQuery, [id]);

        // Fetch fulfillment tracking with center details
        const fulfillmentQuery = `
            SELECT 
                oft.id,
                oft.status AS fulfillment_status,
                oft.note AS fulfillment_note,
                oft.created_at AS fulfillment_updated_at,
                fc.id AS center_id,
                fc.name AS center_name,
                fc.address AS center_address,
                fc.city AS center_city,
                fc.state AS center_state,
                fc.country AS center_country,
                fc.pincode AS center_pincode,
                fc.latitude AS center_latitude,
                fc.longitude AS center_longitude
            FROM order_fulfillment_tracking oft
            LEFT JOIN fulfillment_centers fc ON oft.fulfillment_center_id = fc.id
            WHERE oft.order_id = $1
            ORDER BY oft.created_at ASC;
        `;
        const fulfillmentResult = await pool.query(fulfillmentQuery, [id]);

        return res.status(200).json({
            data: {
                order,
                items: itemsResult.rows,
                statusHistory: statusHistoryResult.rows,
                fulfillmentTracking: fulfillmentResult.rows,
            }
        });
    } catch (error) {
        console.error("Error fetching order tracking:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
}
