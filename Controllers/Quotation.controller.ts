import type { Request, Response } from "express";
import pool from "../DbConnect";
import { sendQuotationRequestEmail, sendQuotationUpdateEmail } from "../helpers/emailService.helper";

type QuotationAction = "offer" | "counter" | "accept" | "reject";

type QuotationRow = {
    id: string;
    user_id: string;
    vendor_id: string;
    product_id: string;
    requested_quantity: number;
    requested_price: number | null;
    status: string;
    current_offer_price: number | null;
    current_offer_quantity: number | null;
    current_offer_by: string | null;
    accepted_price: number | null;
    accepted_quantity: number | null;
};

function normalizeAction(value: unknown): QuotationAction | null {
    if (value === "offer" || value === "counter" || value === "accept" || value === "reject") {
        return value;
    }
    return null;
}

async function getVendorIdForUser(userId: string): Promise<string | null> {
    const result = await pool.query(`SELECT id FROM vendors WHERE user_id = $1`, [userId]);
    return result.rows[0]?.id || null;
}

export const createQuotationFromCartController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;
    if (!authUser?.userId || authUser.role !== "client") {
        return res.status(403).json({ message: "Only clients can request quotations" });
    }

    const { userId } = authUser;
    const { requestNote } = req.body as { requestNote?: string };

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const addressResult = await client.query(
            `SELECT city, state, country, pincode FROM addresses WHERE user_id = $1`,
            [userId]
        );

        if (addressResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "Please add your address before requesting a quotation." });
        }

        const address = addressResult.rows[0];

        const cartResult = await client.query(
            `SELECT id FROM carts WHERE user_id = $1 AND status = 'active' AND cart_type = 'quotation'`,
            [userId]
        );

        if (cartResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "No quotation cart found" });
        }

        const cartId = cartResult.rows[0].id as string;

        const cartItemsResult = await client.query(
            `
                SELECT
                    ci.product_id,
                    ci.vendor_id,
                    ci.quantity,
                    ci.price_at_added,
                    p.name AS product_name,
                    v.company_name AS vendor_name,
                    u.email AS vendor_email
                FROM cart_items ci
                JOIN products p ON ci.product_id = p.id
                JOIN vendors v ON ci.vendor_id = v.id
                JOIN users u ON v.user_id = u.id
                WHERE ci.cart_id = $1
            `,
            [cartId]
        );

        if (cartItemsResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "Quotation cart is empty" });
        }

        const createdQuotationIds: string[] = [];

        for (const item of cartItemsResult.rows) {
            const quotationResult = await client.query(
                `
                    INSERT INTO quotation_requests (
                        user_id,
                        vendor_id,
                        product_id,
                        requested_quantity,
                        requested_price,
                        status,
                        request_note,
                        buyer_city,
                        buyer_state,
                        buyer_country,
                        buyer_pincode
                    ) VALUES ($1, $2, $3, $4, $5, 'pending_vendor', $6, $7, $8, $9, $10)
                    RETURNING id
                `,
                [
                    userId,
                    item.vendor_id,
                    item.product_id,
                    item.quantity,
                    item.price_at_added,
                    requestNote || null,
                    address.city,
                    address.state,
                    address.country,
                    address.pincode,
                ]
            );

            const quotationId = quotationResult.rows[0].id as string;
            createdQuotationIds.push(quotationId);

            await client.query(
                `
                    INSERT INTO quotation_messages (
                        quotation_id,
                        sender_user_id,
                        sender_role,
                        action,
                        offer_price,
                        offer_quantity,
                        note
                    ) VALUES ($1, $2, 'client', 'request', $3, $4, $5)
                `,
                [quotationId, userId, item.price_at_added, item.quantity, requestNote || null]
            );

            if (item.vendor_email) {
                await sendQuotationRequestEmail({
                    vendorEmail: item.vendor_email,
                    vendorName: item.vendor_name || "Vendor",
                    buyerId: userId,
                    buyerCity: address.city,
                    productName: item.product_name,
                    quantity: item.quantity,
                    requestedPrice: item.price_at_added,
                    note: requestNote || undefined,
                });
            }
        }

        await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);

        await client.query("COMMIT");
        return res.status(201).json({ message: "Quotation requests submitted", data: { quotationIds: createdQuotationIds } });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Error creating quotation:", error);
        return res.status(500).json({ message: "Internal server error" });
    } finally {
        client.release();
    }
};

export const getClientQuotationsController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;
    if (!authUser?.userId || authUser.role !== "client") {
        return res.status(403).json({ message: "Only clients can view quotations" });
    }

    try {
        const result = await pool.query(
            `
                SELECT
                    qr.id,
                    qr.status,
                    qr.requested_quantity,
                    qr.requested_price,
                    qr.current_offer_price,
                    qr.current_offer_quantity,
                    qr.current_offer_by,
                    qr.accepted_price,
                    qr.accepted_quantity,
                    qr.rejection_reason,
                    qr.created_at,
                    qr.updated_at,
                    p.name AS product_name,
                    v.company_name AS vendor_name
                FROM quotation_requests qr
                JOIN products p ON qr.product_id = p.id
                JOIN vendors v ON qr.vendor_id = v.id
                WHERE qr.user_id = $1
                ORDER BY qr.updated_at DESC
            `,
            [authUser.userId]
        );

        return res.status(200).json({ data: result.rows });
    } catch (error) {
        console.error("Error fetching client quotations:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const getClientQuotationByIdController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;
    if (!authUser?.userId || authUser.role !== "client") {
        return res.status(403).json({ message: "Only clients can view quotations" });
    }

    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ message: "Quotation ID is required" });
    }

    try {
        const quotationResult = await pool.query(
            `
                SELECT
                    qr.*,
                    p.name AS product_name,
                    v.company_name AS vendor_name
                FROM quotation_requests qr
                JOIN products p ON qr.product_id = p.id
                JOIN vendors v ON qr.vendor_id = v.id
                WHERE qr.id = $1 AND qr.user_id = $2
                LIMIT 1
            `,
            [id, authUser.userId]
        );

        if (quotationResult.rows.length === 0) {
            return res.status(404).json({ message: "Quotation not found" });
        }

        const messagesResult = await pool.query(
            `
                SELECT id, sender_role, action, offer_price, offer_quantity, note, reason, created_at
                FROM quotation_messages
                WHERE quotation_id = $1
                ORDER BY created_at ASC
            `,
            [id]
        );

        return res.status(200).json({ data: { quotation: quotationResult.rows[0], messages: messagesResult.rows } });
    } catch (error) {
        console.error("Error fetching quotation:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const respondClientQuotationController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;
    if (!authUser?.userId || authUser.role !== "client") {
        return res.status(403).json({ message: "Only clients can respond to quotations" });
    }

    const { id } = req.params;
    const action = normalizeAction(req.body?.action);
    const offerPrice = req.body?.offerPrice;
    const offerQuantity = req.body?.offerQuantity;
    const reason = req.body?.reason;
    const note = req.body?.note;

    if (!id || !action) {
        return res.status(400).json({ message: "Quotation ID and action are required" });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const quotationResult = await client.query(
            `SELECT * FROM quotation_requests WHERE id = $1 AND user_id = $2 LIMIT 1`,
            [id, authUser.userId]
        );

        if (quotationResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Quotation not found" });
        }

        const quotation = quotationResult.rows[0] as QuotationRow;

        if (["client_accepted", "client_rejected", "vendor_rejected", "cancelled", "expired"].includes(quotation.status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "Quotation is closed and cannot be updated" });
        }

        if (quotation.current_offer_by !== "vendor") {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "Waiting for vendor response before you can act on this quotation" });
        }

        if (action === "counter") {
            if (!offerPrice || !offerQuantity || !reason) {
                await client.query("ROLLBACK");
                return res.status(400).json({ message: "Offer price, quantity, and reason are required for counter offers" });
            }

            await client.query(
                `
                    UPDATE quotation_requests
                    SET status = 'client_countered',
                        current_offer_price = $1,
                        current_offer_quantity = $2,
                        current_offer_by = 'client',
                        updated_at = NOW()
                    WHERE id = $3
                `,
                [offerPrice, offerQuantity, id]
            );

            await client.query(
                `
                    INSERT INTO quotation_messages (quotation_id, sender_user_id, sender_role, action, offer_price, offer_quantity, note, reason)
                    VALUES ($1, $2, 'client', 'counter', $3, $4, $5, $6)
                `,
                [id, authUser.userId, offerPrice, offerQuantity, note || null, reason]
            );
        } else if (action === "accept") {
            if (quotation.current_offer_by !== "vendor" || !quotation.current_offer_price || !quotation.current_offer_quantity) {
                await client.query("ROLLBACK");
                return res.status(400).json({ message: "Vendor offer is required before accepting" });
            }

            const addressResult = await client.query(
                `SELECT * FROM addresses WHERE user_id = $1`,
                [authUser.userId]
            );
            if (addressResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return res.status(400).json({ message: "No address found for client" });
            }

            const address = addressResult.rows[0];

            const orderResult = await client.query(
                `
                    INSERT INTO orders (
                        user_id, vendor_id, status, payment_status, total_amount,
                        address_line, city, state, country, pincode, latitude, langitude,
                        source, order_type
                    ) VALUES ($1, $2, 'pending', 'pending', $3, $4, $5, $6, $7, $8, $9, $10, 'client', 'quotation')
                    RETURNING id
                `,
                [
                    authUser.userId,
                    quotation.vendor_id,
                    Number(quotation.current_offer_price) * Number(quotation.current_offer_quantity),
                    address.address,
                    address.city,
                    address.state,
                    address.country,
                    address.pincode,
                    address.latitude,
                    address.longitude || address.latitude,
                ]
            );

            const orderId = orderResult.rows[0].id as string;

            await client.query(
                `
                    INSERT INTO order_items (order_id, product_id, vendor_id, quantity, price)
                    VALUES ($1, $2, $3, $4, $5)
                `,
                [orderId, quotation.product_id, quotation.vendor_id, quotation.current_offer_quantity, quotation.current_offer_price]
            );

            await client.query(
                `
                    INSERT INTO order_status_history (order_id, status, note, created_at)
                    VALUES ($1, 'pending', 'Quotation accepted by client', CURRENT_TIMESTAMP)
                `,
                [orderId]
            );

            await client.query(
                `
                    UPDATE quotation_requests
                    SET status = 'client_accepted',
                        accepted_price = $1,
                        accepted_quantity = $2,
                        order_id = $3,
                        updated_at = NOW()
                    WHERE id = $4
                `,
                [quotation.current_offer_price, quotation.current_offer_quantity, orderId, id]
            );

            await client.query(
                `
                    INSERT INTO quotation_messages (quotation_id, sender_user_id, sender_role, action, note)
                    VALUES ($1, $2, 'client', 'accept', $3)
                `,
                [id, authUser.userId, note || null]
            );
        } else if (action === "reject") {
            if (!reason) {
                await client.query("ROLLBACK");
                return res.status(400).json({ message: "Reason is required for rejection" });
            }

            await client.query(
                `
                    UPDATE quotation_requests
                    SET status = 'client_rejected',
                        rejection_reason = $1,
                        updated_at = NOW()
                    WHERE id = $2
                `,
                [reason, id]
            );

            await client.query(
                `
                    INSERT INTO quotation_messages (quotation_id, sender_user_id, sender_role, action, reason, note)
                    VALUES ($1, $2, 'client', 'reject', $3, $4)
                `,
                [id, authUser.userId, reason, note || null]
            );
        }

        const vendorResult = await client.query(
            `
                SELECT u.email AS vendor_email, v.company_name AS vendor_name
                FROM vendors v
                JOIN users u ON v.user_id = u.id
                WHERE v.id = $1
            `,
            [quotation.vendor_id]
        );

        if (vendorResult.rows.length) {
            await sendQuotationUpdateEmail({
                recipientEmail: vendorResult.rows[0].vendor_email,
                recipientName: vendorResult.rows[0].vendor_name || "Vendor",
                quotationId: id,
                status: action === "counter" ? "client_countered" : action === "accept" ? "client_accepted" : "client_rejected",
                note: note || undefined,
                reason: reason || undefined,
            });
        }

        await client.query("COMMIT");
        return res.status(200).json({ message: "Quotation response saved" });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Error responding to quotation:", error);
        return res.status(500).json({ message: "Internal server error" });
    } finally {
        client.release();
    }
};

export const getVendorQuotationsController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;
    if (!authUser?.userId || authUser.role !== "vendor") {
        return res.status(403).json({ message: "Only vendors can view quotations" });
    }

    try {
        const vendorId = await getVendorIdForUser(authUser.userId);
        if (!vendorId) {
            return res.status(404).json({ message: "Vendor not found" });
        }

        const result = await pool.query(
            `
                SELECT
                    qr.id,
                    qr.status,
                    qr.requested_quantity,
                    qr.requested_price,
                    qr.current_offer_price,
                    qr.current_offer_quantity,
                    qr.current_offer_by,
                    qr.accepted_price,
                    qr.accepted_quantity,
                    qr.rejection_reason,
                    qr.buyer_city,
                    qr.buyer_state,
                    qr.buyer_country,
                    qr.buyer_pincode,
                    qr.user_id AS buyer_id,
                    qr.created_at,
                    qr.updated_at,
                    p.name AS product_name
                FROM quotation_requests qr
                JOIN products p ON qr.product_id = p.id
                WHERE qr.vendor_id = $1
                ORDER BY qr.updated_at DESC
            `,
            [vendorId]
        );

        return res.status(200).json({ data: result.rows });
    } catch (error) {
        console.error("Error fetching vendor quotations:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const getVendorQuotationByIdController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;
    if (!authUser?.userId || authUser.role !== "vendor") {
        return res.status(403).json({ message: "Only vendors can view quotations" });
    }

    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ message: "Quotation ID is required" });
    }

    try {
        const vendorId = await getVendorIdForUser(authUser.userId);
        if (!vendorId) {
            return res.status(404).json({ message: "Vendor not found" });
        }

        const quotationResult = await pool.query(
            `
                SELECT
                    qr.*,
                    p.name AS product_name
                FROM quotation_requests qr
                JOIN products p ON qr.product_id = p.id
                WHERE qr.id = $1 AND qr.vendor_id = $2
                LIMIT 1
            `,
            [id, vendorId]
        );

        if (quotationResult.rows.length === 0) {
            return res.status(404).json({ message: "Quotation not found" });
        }

        const messagesResult = await pool.query(
            `
                SELECT id, sender_role, action, offer_price, offer_quantity, note, reason, created_at
                FROM quotation_messages
                WHERE quotation_id = $1
                ORDER BY created_at ASC
            `,
            [id]
        );

        return res.status(200).json({ data: { quotation: quotationResult.rows[0], messages: messagesResult.rows } });
    } catch (error) {
        console.error("Error fetching vendor quotation:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const respondVendorQuotationController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;
    if (!authUser?.userId || authUser.role !== "vendor") {
        return res.status(403).json({ message: "Only vendors can respond to quotations" });
    }

    const { id } = req.params;
    const action = normalizeAction(req.body?.action);
    const offerPrice = req.body?.offerPrice;
    const offerQuantity = req.body?.offerQuantity;
    const reason = req.body?.reason;
    const note = req.body?.note;

    if (!id || !action) {
        return res.status(400).json({ message: "Quotation ID and action are required" });
    }

    if (action === "offer" || action === "counter") {
        if (!offerPrice || !offerQuantity) {
            return res.status(400).json({ message: "Offer price and quantity are required" });
        }
        if (action === "counter" && !reason) {
            return res.status(400).json({ message: "Reason is required for counter offer" });
        }
    }

    if (action === "reject" && !reason) {
        return res.status(400).json({ message: "Reason is required for rejection" });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const vendorId = await getVendorIdForUser(authUser.userId);
        if (!vendorId) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Vendor not found" });
        }

        const quotationResult = await client.query(
            `SELECT * FROM quotation_requests WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
            [id, vendorId]
        );

        if (quotationResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Quotation not found" });
        }

        const quotation = quotationResult.rows[0] as QuotationRow;

        if (["client_accepted", "client_rejected", "vendor_rejected", "cancelled", "expired"].includes(quotation.status)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "Quotation is closed and cannot be updated" });
        }

        if (quotation.current_offer_by === "vendor" && quotation.status !== "client_countered") {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "Vendor has already responded. Wait for the client to counter before replying again." });
        }

        if (action === "offer" || action === "counter") {
            const nextStatus = action === "offer" ? "vendor_offered" : "vendor_countered";

            await client.query(
                `
                    UPDATE quotation_requests
                    SET status = $1,
                        current_offer_price = $2,
                        current_offer_quantity = $3,
                        current_offer_by = 'vendor',
                        updated_at = NOW()
                    WHERE id = $4
                `,
                [nextStatus, offerPrice, offerQuantity, id]
            );

            await client.query(
                `
                    INSERT INTO quotation_messages (quotation_id, sender_user_id, sender_role, action, offer_price, offer_quantity, note, reason)
                    VALUES ($1, $2, 'vendor', $3, $4, $5, $6, $7)
                `,
                [id, authUser.userId, action, offerPrice, offerQuantity, note || null, reason || null]
            );
        } else if (action === "reject") {
            await client.query(
                `
                    UPDATE quotation_requests
                    SET status = 'vendor_rejected',
                        rejection_reason = $1,
                        updated_at = NOW()
                    WHERE id = $2
                `,
                [reason, id]
            );

            await client.query(
                `
                    INSERT INTO quotation_messages (quotation_id, sender_user_id, sender_role, action, reason, note)
                    VALUES ($1, $2, 'vendor', 'reject', $3, $4)
                `,
                [id, authUser.userId, reason, note || null]
            );
        }

        const clientResult = await client.query(
            `SELECT u.email AS client_email, u.name AS client_name FROM users u WHERE u.id = $1`,
            [quotation.user_id]
        );

        if (clientResult.rows.length) {
            await sendQuotationUpdateEmail({
                recipientEmail: clientResult.rows[0].client_email,
                recipientName: clientResult.rows[0].client_name || "Client",
                quotationId: id,
                status: action === "offer" ? "vendor_offered" : action === "counter" ? "vendor_countered" : "vendor_rejected",
                note: note || undefined,
                reason: reason || undefined,
            });
        }

        await client.query("COMMIT");
        return res.status(200).json({ message: "Quotation response saved" });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Error responding to vendor quotation:", error);
        return res.status(500).json({ message: "Internal server error" });
    } finally {
        client.release();
    }
};
