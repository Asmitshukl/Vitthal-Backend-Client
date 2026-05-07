import type { Request, Response } from "express";
import pool from "../DbConnect";

const actionTaker = ['super_admin', 'admin', 'vendor'];

type SpecificationEntry = {
    spec_key: string;
    spec_value: string;
    approval_status: "pending" | "approved" | "rejected";
};

const approvedSpecificationsSelect = `
                COALESCE(specAgg.specifications, '{}'::jsonb) AS specifications
            `;

const approvedSpecificationsJoin = `
            LEFT JOIN LATERAL (
                SELECT COALESCE(
                    jsonb_object_agg(ps.spec_key, ps.spec_value ORDER BY ps.created_at),
                    '{}'::jsonb
                ) AS specifications
                FROM product_specification ps
                WHERE ps.product_id = p.id
                  AND ps.approval_status = 'approved'
            ) specAgg ON true
        `;

function normalizeSpecificationEntries(
    specifications: unknown,
    defaultApprovalStatus: "pending" | "approved"
): SpecificationEntry[] {
    if (!specifications) {
        return [];
    }

    const rawEntries = Array.isArray(specifications)
        ? specifications
        : typeof specifications === "object"
            ? Object.entries(specifications as Record<string, unknown>).map(([key, value]) => ({ key, value }))
            : (() => {
                if (typeof specifications !== "string") {
                    return [] as Array<{ key: string; value: unknown }>;
                }

                try {
                    const parsed = JSON.parse(specifications) as unknown;
                    if (Array.isArray(parsed)) {
                        return parsed as Array<{ key: string; value: unknown }>;
                    }

                    if (parsed && typeof parsed === "object") {
                        return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({ key, value }));
                    }

                    return [] as Array<{ key: string; value: unknown }>;
                }
                catch {
                    return [] as Array<{ key: string; value: unknown }>;
                }
            })();

    return rawEntries
        .map((entry) => {
            const key = String((entry as { key?: unknown; spec_key?: unknown }).key ?? (entry as { key?: unknown; spec_key?: unknown }).spec_key ?? "").trim();
            const value = String((entry as { value?: unknown; spec_value?: unknown }).value ?? (entry as { value?: unknown; spec_value?: unknown }).spec_value ?? "").trim();
            const approvalStatus = (entry as { approval_status?: unknown }).approval_status;

            if (!key) {
                return null;
            }

            if (approvalStatus === "pending" || approvalStatus === "approved" || approvalStatus === "rejected") {
                return { spec_key: key, spec_value: value, approval_status: approvalStatus };
            }

            return { spec_key: key, spec_value: value, approval_status: defaultApprovalStatus };
        })
        .filter((entry): entry is SpecificationEntry => Boolean(entry));
}

async function getVendorAllowedCategories(userId: string) {
    const categoryResult = await pool.query(
        `
            SELECT pc.code, pc.label
            FROM vendors v
            JOIN vendor_categories vc ON vc.vendor_id = v.id
            JOIN product_category pc ON pc.id = vc.category_id
            WHERE v.user_id = $1
              AND pc.is_active = TRUE
        `,
        [userId]
    );

    return categoryResult.rows as Array<{ code: string; label: string }>;
}

async function getApprovedVendorProfile(userId: string) {
    const vendorResult = await pool.query(
        `
            SELECT id, approval_status, is_active, is_blocked
            FROM vendors
            WHERE user_id = $1
        `,
        [userId]
    );

    if (!vendorResult.rows.length) {
        throw new Error("Please complete your vendor profile before adding products.");
    }

    const vendor = vendorResult.rows[0];
    if (vendor.approval_status !== "approved" || !vendor.is_active || vendor.is_blocked) {
        throw new Error("Your vendor account must be approved and active before you can add products.");
    }

    return vendor as { id: string; approval_status: string; is_active: boolean; is_blocked: boolean };
}

async function getVendorProfileIfExists(userId: string) {
    const vendorResult = await pool.query(
        `
            SELECT id, approval_status, is_active, is_blocked
            FROM vendors
            WHERE user_id = $1
        `,
        [userId]
    );

    return vendorResult.rows[0] as
        | { id: string; approval_status: string; is_active: boolean; is_blocked: boolean }
        | undefined;
}

export const addProductController = async (req: Request, res: Response): Promise<Response> => {
    const { name, description, category, productType, specifications } = req.body;

    const { role, userId } = (req as any).user;
    if (!name || !description || !category || !productType) {
        return res.status(400).json({ message: "Name, description, category, and productType are required" });
    }

    const vendorProfile = userId ? await getVendorProfileIfExists(userId) : undefined;
    const isApprovedVendorActor = Boolean(
        vendorProfile &&
        vendorProfile.approval_status === "approved" &&
        vendorProfile.is_active &&
        !vendorProfile.is_blocked
    );
    const canCreateProduct = actionTaker.includes(role) || isApprovedVendorActor;

    if (!canCreateProduct) {
        return res.status(403).json({ message: "Unauthorized! Only admins, super admins, and vendors can add products." });
    }

    const actsAsVendor = role === "vendor" || isApprovedVendorActor;
    if (actsAsVendor) {
        const allowedCategories = await getVendorAllowedCategories(userId);
        const normalizedCategory = String(category).trim().toLowerCase();
        const hasAllowedCategory = allowedCategories.some((allowedCategory) => {
            return allowedCategory.code.trim().toLowerCase() === normalizedCategory || allowedCategory.label.trim().toLowerCase() === normalizedCategory;
        });

        if (!hasAllowedCategory) {
            return res.status(403).json({ message: "You can only add products that belong to your assigned vendor categories." });
        }
    }

    const parsedSpecifications = normalizeSpecificationEntries(
        specifications,
        actsAsVendor ? "pending" : "approved"
    );

    const client = await pool.connect();

    try {
        const approvalStatus = actsAsVendor ? "pending" : "approved";
        await client.query("BEGIN");

        const query = `
            INSERT INTO products (
                name,
                description,
                category,
                product_type,
                approval_status,
                created_by_user_id,
                is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            returning *
        `;
        const values = [
            name,
            description,
            category,
            productType,
            approvalStatus,
            userId,
            !actsAsVendor
        ];
        const result = await client.query(query, values);

        if (parsedSpecifications.length > 0) {
            for (const specification of parsedSpecifications) {
                await client.query(
                    `
                        INSERT INTO product_specification (
                            product_id,
                            spec_key,
                            spec_value,
                            approval_status,
                            created_by_user_id
                        )
                        VALUES ($1, $2, $3, $4, $5)
                    `,
                        [
                        result.rows[0].id,
                        specification.spec_key,
                        specification.spec_value,
                        specification.approval_status,
                        userId
                    ]
                );
            }
        }

        await client.query("COMMIT");
        return res.status(201).json({
            message: actsAsVendor ? "Product submitted for approval successfully" : "Product added successfully",
            result: result.rows[0]
        });
    }
    catch (error) {
        await client.query("ROLLBACK");
        if (error instanceof Error) {
            return res.status(400).json({ message: error.message });
        }
        console.log("Error while adding Products : ", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
    finally {
        client.release();
    }
}

export const addVendorProductController = async (req: Request, res: Response): Promise<Response> => {
    const { productId, price, moq, stockQuantity } = req.body;
    const { userId, role } = (req as any).user;

    if (!productId || price === undefined || !moq || stockQuantity === undefined) {
        return res.status(400).json({ message: "Product ID, price, moq, and stockQuantity are required" });
    }

    try {
        const vendorProfile = await getVendorProfileIfExists(userId);
        if (role !== "vendor" && !vendorProfile) {
            return res.status(403).json({ message: "Unauthorized! Only vendors can add pricing/stock to products." });
        }

        const vendor = await getApprovedVendorProfile(userId);

        const productResult = await pool.query(
            `SELECT id, approval_status, created_by_user_id FROM products WHERE id = $1`,
            [productId]
        );

        if (productResult.rows.length === 0) {
            return res.status(404).json({ message: "Product not found." });
        }

        const product = productResult.rows[0];
        const canAttachPendingOwnProduct =
            product.approval_status === "pending" && product.created_by_user_id === userId;

        if (product.approval_status !== "approved" && !canAttachPendingOwnProduct) {
            return res.status(403).json({ message: "You can only add pricing for approved products or your own pending submission." });
        }

        const vendorId = vendor.id;

        const query = `
            INSERT INTO vendor_products (product_id, vendor_id, price, moq, stock_quantity) 
            VALUES ($1, $2, $3, $4, $5) 
            ON CONFLICT (vendor_id, product_id) 
            DO UPDATE SET price = EXCLUDED.price, moq = EXCLUDED.moq, stock_quantity = EXCLUDED.stock_quantity
            RETURNING *`;
        const values = [productId, vendorId, price, moq, stockQuantity];
        const result = await pool.query(query, values);
        return res.status(201).json({ message: "Vendor product details saved successfully", result: result.rows[0] });
    }
    catch (error) {
        console.log("Error while saving Vendor Product details : ", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

export const addProductSpecificationsController = async (req: Request, res: Response): Promise<Response> => {
    const { productId, specifications } = req.body;
    const { userId, role } = (req as any).user;

    if (!productId || !specifications) {
        return res.status(400).json({ message: "productId and specifications are required" });
    }

    try {
        // Ensure product exists
        const productResult = await pool.query(`SELECT id, approval_status FROM products WHERE id = $1`, [productId]);
        if (productResult.rows.length === 0) {
            return res.status(404).json({ message: "Product not found." });
        }

        const actsAsVendor = role === "vendor";
        const parsedSpecifications = normalizeSpecificationEntries(specifications, actsAsVendor ? "pending" : "approved");

        if (parsedSpecifications.length === 0) {
            return res.status(400).json({ message: "No valid specifications provided." });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            for (const specification of parsedSpecifications) {
                await client.query(
                    `INSERT INTO product_specification (product_id, spec_key, spec_value, approval_status, created_by_user_id)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [productId, specification.spec_key, specification.spec_value, specification.approval_status, userId]
                );
            }

            await client.query("COMMIT");
            return res.status(201).json({ message: actsAsVendor ? "Specifications submitted for approval" : "Specifications added successfully" });
        } catch (err) {
            await client.query("ROLLBACK");
            console.error("Error inserting product specifications:", err);
            return res.status(500).json({ message: "Internal Server Error" });
        } finally {
            client.release();
        }
    }
    catch (error) {
        console.error("Error while adding product specifications : ", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

export const deleteProduct = async (req: Request, res: Response): Promise<Response> => {
    const { productId } = req.body;
    const { role } = (req as any).user;

    if (!productId) {
        return res.status(400).json({ message: "Product ID is required" });
    }

    if (role !== "admin" && role !== "super_admin") {
        return res.status(403).json({ message: "Unauthorized! Only admins and super admins can delete products." });
    }

    try {
        const query = `DELETE FROM products WHERE id = $1`;
        const values = [productId];
        const result = await pool.query(query, values);
        return res.status(200).json({ message: "Product deleted successfully", result });
    }
    catch (error) {
        console.log("Error while deleting Products : ", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

export const updateProduct = async (req: Request, res: Response): Promise<Response> => {
    const { productId, name, description, category, productType } = req.body;
    const { role } = (req as any).user;

    if (!productId) {
        return res.status(400).json({ message: "Product ID is required" });
    }

    if (role !== "admin" && role !== "super_admin") {
        return res.status(403).json({ message: "Unauthorized! Only admins and super admins can update products." });
    }

    try {
        const query = `UPDATE products SET name = $1, description = $2, category = $3, product_type = $4 WHERE id = $5`;
        const values = [name, description, category, productType, productId];
        const result = await pool.query(query, values);
        return res.status(200).json({ message: "Product updated successfully", result });
    }
    catch (error) {
        console.log("Error while updating Products : ", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

export const getAllProducts = async (req: Request, res: Response): Promise<Response> => {
    try {
        const { offset, limit, search, category, productType } = req.query;
        if (offset === undefined || offset === null || isNaN(Number(offset))) {
            return res.status(400).json({ message: "Invalid offset value" });
        }
        const limitValue = Number(limit) > 20 ? 20 : Number(limit) || 20;
        const offsetValue = Number(offset) * limitValue;

        let baseQuery = `
            SELECT id, name, description, category, product_type
            FROM products
            WHERE approval_status = 'approved' AND is_active = TRUE
        `;
        let countQuery = `
            SELECT COUNT(*)::int AS total_count
            FROM products
            WHERE approval_status = 'approved' AND is_active = TRUE
        `;

        const values: any[] = [];
        let paramCount = 1;

        if (search && typeof search === 'string' && search.trim() !== '') {
            baseQuery += ` AND name ILIKE $${paramCount}`;
            countQuery += ` AND name ILIKE $${paramCount}`;
            values.push(`%${search.trim()}%`);
            paramCount++;
        }

        if (category && typeof category === 'string' && category.trim() !== '') {
            baseQuery += ` AND LOWER(category) = LOWER($${paramCount})`;
            countQuery += ` AND LOWER(category) = LOWER($${paramCount})`;
            values.push(category.trim());
            paramCount++;
        }

        if (productType && typeof productType === 'string' && productType.trim() !== '') {
            baseQuery += ` AND product_type = $${paramCount}`;
            countQuery += ` AND product_type = $${paramCount}`;
            values.push(productType.trim());
            paramCount++;
        }

        baseQuery += ` ORDER BY created_at DESC, id ASC LIMIT $${paramCount + 1} OFFSET $${paramCount}`;
        const queryValues = [...values, offsetValue, limitValue];

        const query = `
            SELECT 
                p.id AS product_id,
                p.name AS product_name,
                p.description,
                p.category,
                p.product_type,
                ${approvedSpecificationsSelect},

                -- Primary image
                pImg.image_url AS primary_image,

                -- Seller count (cast to int)
                COALESCE(vc.vendor_count, 0)::int AS seller_count,

                -- Price range (cast to numeric)
                COALESCE(pr.min_price, 0)::numeric AS min_price,
                COALESCE(pr.max_price, 0)::numeric AS max_price,
                COALESCE(pr.min_moq, 1)::int AS min_moq

            FROM (
                ${baseQuery}
            ) p

            ${approvedSpecificationsJoin}

            -- Primary image (no duplication)
            LEFT JOIN products_images pImg 
                ON p.id = pImg.product_id 
                AND pImg.is_primary = true

            -- Vendor count (lightweight aggregation)
            LEFT JOIN LATERAL (
                SELECT COUNT(DISTINCT vendor_id)::int AS vendor_count
                FROM vendor_products vp
                JOIN vendors v ON v.id = vp.vendor_id
                JOIN users u ON u.id = v.user_id
                WHERE vp.product_id = p.id
                  AND vp.is_active = true
                  AND v.approval_status = 'approved'
                  AND v.is_active = true
                  AND v.is_blocked = false
                  AND u.is_active = true
            ) vc ON true

            -- Price range from vendor_products
            LEFT JOIN LATERAL (
                SELECT 
                    MIN(price)::numeric AS min_price, 
                    MAX(price)::numeric AS max_price,
                    MIN(moq)::int AS min_moq
                FROM vendor_products vp
                JOIN vendors v ON v.id = vp.vendor_id
                JOIN users u ON u.id = v.user_id
                WHERE vp.product_id = p.id
                  AND vp.is_active = true
                  AND v.approval_status = 'approved'
                  AND v.is_active = true
                  AND v.is_blocked = false
                  AND u.is_active = true
            ) pr ON true;
        `;

        const result = await pool.query(query, queryValues);
        const countResult = await pool.query(countQuery, values);
        const totalCount = countResult.rows[0].total_count;
        return res.status(200).json({ message: "Products fetched successfully", totalCount, data: result.rows });
    }
    catch (e) {
        console.log("Error while fetching Products : ", e);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

export const getProductById = async (req: Request, res: Response): Promise<Response> => {
    const { productId } = req.params;
    if (!productId) {
        return res.status(400).json({ message: "Product ID is required" });
    }

    try {
        const query = `
           SELECT 
                p.id AS product_id,
                p.name AS product_name,
                p.description,
                p.category,
                p.product_type,
                p.material,
                p.grade,
                p.application,
                p.standard,
                p.rating,
                p.review_count,
                ${approvedSpecificationsSelect},

                -- Images array
                COALESCE(
                    JSON_AGG(
                        JSONB_BUILD_OBJECT(
                            'image_url', pImg.image_url,
                            'is_primary', pImg.is_primary,
                            'display_order', pImg.display_order
                        )
                        ORDER BY pImg.display_order
                    ) FILTER (WHERE pImg.id IS NOT NULL),
                    '[]'
                ) AS images,

                -- Vendors array (with rating, review_count, and vendor address coordinates)
                COALESCE(
                    JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(
                        'vendor_id', v.id,
                        'price', vp.price,
                        'moq', vp.moq,
                        'stock_quantity', vp.stock_quantity,
                        'rating', v.rating,
                        'review_count', v.review_count,
                        'latitude', va.latitude,
                        'longitude', va.longitude
                    )) FILTER (WHERE v.id IS NOT NULL),
                    '[]'
                ) AS vendors

            FROM products p
            ${approvedSpecificationsJoin}
            LEFT JOIN products_images pImg ON p.id = pImg.product_id
            LEFT JOIN vendor_products vp ON p.id = vp.product_id
            LEFT JOIN vendors v ON vp.vendor_id = v.id
            LEFT JOIN users u ON v.user_id = u.id
            LEFT JOIN addresses va ON v.user_id = va.user_id

            WHERE p.id = $1
              AND p.approval_status = 'approved'
              AND p.is_active = TRUE
              AND (v.id IS NULL OR (
                    vp.is_active = true
                AND v.approval_status = 'approved'
                AND v.is_active = true
                AND v.is_blocked = false
                AND u.is_active = true
              ))

            GROUP BY p.id, specAgg.specifications;
        `;
        const result = await pool.query(query, [productId]);

        return res.status(200).json({ message: "Product fetched successfully", data: result.rows[0] });
    }
    catch (e) {
        console.log("Error while fetching Product by Id : ", e);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};

export const getProductsByCategory = async (req: Request, res: Response): Promise<Response> => {
    const validCategories = ['plastic', 'metal', 'steel'];
    const { category } = req.params;
    const { offset, limit } = req.query;
    const limitValue = Number(limit) > 20 ? 20 : Number(limit) || 20;
    const offsetValue = Number(offset) * limitValue;

    try {
        if (!category || typeof category !== "string" || !validCategories.includes(category))
            return res.status(400).json({ message: "Invalid category! Category should be either plastic, metal or steel!" });

        if (offset === undefined || offset === null || isNaN(Number(offset)))
            return res.status(400).json({ message: "Invalid offset value" });

        const query = `
            SELECT 
                p.id AS product_id,
                p.name AS product_name,
                p.description,
                p.category,
                p.product_type,
                ${approvedSpecificationsSelect},

                -- Primary image
                pImg.image_url AS primary_image,

                -- Vendor count (optimized, cast to int)
                COALESCE(vc.vendor_count, 0)::int AS vendor_count,

                -- Price range (cast to numeric)
                COALESCE(pr.min_price, 0)::numeric AS min_price,
                COALESCE(pr.max_price, 0)::numeric AS max_price,
                COALESCE(pr.min_moq, 1)::int AS min_moq

            FROM (
                SELECT id, name, description, category, product_type
                FROM products
                WHERE LOWER(category) = LOWER($1)
                  AND approval_status = 'approved'
                  AND is_active = TRUE
                ORDER BY created_at DESC, id ASC
                LIMIT $3 OFFSET $2
            ) p

                        ${approvedSpecificationsJoin}

            -- Primary image (no duplication)
            LEFT JOIN products_images pImg 
                ON p.id = pImg.product_id 
                AND pImg.is_primary = true

            -- Vendor count (ONLY for selected products)
            LEFT JOIN LATERAL (
                SELECT COUNT(DISTINCT vendor_id)::int AS vendor_count
                FROM vendor_products vp
                JOIN vendors v ON v.id = vp.vendor_id
                JOIN users u ON u.id = v.user_id
                WHERE vp.product_id = p.id
                  AND vp.is_active = true
                  AND v.approval_status = 'approved'
                  AND v.is_active = true
                  AND v.is_blocked = false
                  AND u.is_active = true
            ) vc ON true

            -- Price range from vendor_products
            LEFT JOIN LATERAL (
                SELECT 
                    MIN(price)::numeric AS min_price, 
                    MAX(price)::numeric AS max_price,
                    MIN(moq)::int AS min_moq
                FROM vendor_products vp
                JOIN vendors v ON v.id = vp.vendor_id
                JOIN users u ON u.id = v.user_id
                WHERE vp.product_id = p.id
                  AND vp.is_active = true
                  AND v.approval_status = 'approved'
                  AND v.is_active = true
                  AND v.is_blocked = false
                  AND u.is_active = true
            ) pr ON true;
        `;

        const result = await pool.query(query, [category, offsetValue, limitValue]);
        const countResult = await pool.query(
            `SELECT COUNT(*)::int AS total_count FROM products WHERE LOWER(category) = LOWER($1) AND approval_status = 'approved' AND is_active = TRUE`,
            [category]
        );
        const totalCount = countResult.rows[0].total_count;
        return res.status(200).json({ message: "Products fetched successfully", totalCount, data: result.rows });
    }
    catch (e) {
        console.log("Error while fetching Product by category : ", e);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

export const getProductByName = async (req: Request, res: Response): Promise<Response> => {
    const { name } = req.query;
    const { offset, limit } = req.query;

    if (!name || typeof name !== "string") {
        return res.status(400).json({ message: "Product name is required and should be a string" });
    }

    const limitValue = Number(limit) > 20 ? 20 : Number(limit) || 20;
    const offsetValue = offset ? Number(offset) * limitValue : 0;

    try {
        //fuzzy search using ILIKE for case-insensitive partial matching
        const query = `
            SELECT 
                p.id AS product_id,
                p.name AS product_name,
                p.description,
                p.category,
                p.product_type,
                ${approvedSpecificationsSelect},

                pImg.image_url AS primary_image,

                COALESCE(vc.vendor_count, 0)::int AS vendor_count

            FROM (
                SELECT id, name, description, category, product_type
                FROM products
                WHERE name ILIKE $1
                  AND approval_status = 'approved'
                  AND is_active = TRUE
                ORDER BY created_at DESC, id ASC
                LIMIT $3 OFFSET $2
            ) p

                        ${approvedSpecificationsJoin}

            LEFT JOIN products_images pImg 
                ON p.id = pImg.product_id 
                AND pImg.is_primary = true

            LEFT JOIN LATERAL (
                SELECT COUNT(DISTINCT vendor_id)::int AS vendor_count
                FROM vendor_products vp
                JOIN vendors v ON v.id = vp.vendor_id
                JOIN users u ON u.id = v.user_id
                WHERE vp.product_id = p.id
                  AND vp.is_active = true
                  AND v.approval_status = 'approved'
                  AND v.is_active = true
                  AND v.is_blocked = false
                  AND u.is_active = true
            ) vc ON true;
        `;
        const result = await pool.query(query, [`%${name}%`, offsetValue, limitValue]);
        const countResult = await pool.query(
            `SELECT COUNT(*)::int AS total_count FROM products WHERE name ILIKE $1 AND approval_status = 'approved' AND is_active = TRUE`,
            [`%${name}%`]
        );
        const totalCount = countResult.rows[0].total_count;
        return res.status(200).json({ message: "Product fetched successfully", totalCount, data: result.rows });
    }
    catch (e) {
        console.log("Error while fetching Product by name : ", e);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

export const getVendorProductsController = async (req: Request, res: Response): Promise<Response> => {
    const { userId, role } = (req as any).user;
    const { search, category, productType, status } = req.query;

    if (role !== "vendor") {
        return res.status(403).json({ message: "Unauthorized! Only vendors can access their products." });
    }

    try {
        const vendorResult = await pool.query(
            `
                SELECT id, approval_status, approval_notes, is_active, is_blocked
                FROM vendors
                WHERE user_id = $1
            `,
            [userId]
        );

        if (vendorResult.rows.length === 0) {
            return res.status(403).json({ message: "Please setup your profile first! Go to Profile -> Setup Profile to complete your registration." });
        }

        const vendor = vendorResult.rows[0];
        const vendorId = vendor.id;

        let query = `
            SELECT 
                p.id AS product_id,
                p.name AS product_name,
                p.category,
                p.product_type,
                vp.price,
                vp.moq,
                vp.stock_quantity,
                vp.is_active AS status,
                vp.created_at AS created_date,
                pImg.image_url AS primary_image,
                p.approval_status,
                p.approval_notes
            FROM vendor_products vp
            JOIN products p ON vp.product_id = p.id
            LEFT JOIN products_images pImg ON p.id = pImg.product_id AND pImg.is_primary = true
            WHERE vp.vendor_id = $1
        `;

        const values: any[] = [vendorId];
        let paramCount = 2;

        if (search && typeof search === 'string' && search.trim() !== '') {
            query += ` AND p.name ILIKE $${paramCount}`;
            values.push(`%${search.trim()}%`);
            paramCount++;
        }

        if (category && typeof category === 'string' && category.trim() !== '') {
            query += ` AND p.category = $${paramCount}`;
            values.push(category.trim());
            paramCount++;
        }

        if (productType && typeof productType === 'string' && productType.trim() !== '') {
            query += ` AND p.product_type = $${paramCount}`;
            values.push(productType.trim());
            paramCount++;
        }

        if (status && typeof status === 'string' && status.trim() !== '') {
            query += ` AND vp.is_active = $${paramCount}`;
            values.push(status.trim() === 'active');
            paramCount++;
        }

        query += ` ORDER BY vp.created_at DESC`;

        const result = await pool.query(query, values);
        return res.status(200).json({ message: "Vendor products fetched successfully", data: result.rows });
    } catch (error) {
        console.log("Error while fetching vendor products : ", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export const getRankedVendors = async (req: Request, res: Response): Promise<Response> => {
    const { productId } = req.params;
    const { userLat, userLng } = req.query;

    if (!productId) {
        return res.status(400).json({ message: "Product ID is required" });
    }

    const parsedLat = Number(userLat);
    const parsedLng = Number(userLng);

    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
        return res.status(400).json({ message: "Valid userLat and userLng query parameters are required" });
    }

    try {
        const query = `
            SELECT
                v.id AS vendor_id,
                vp.price,
                vp.moq,
                vp.stock_quantity,
                v.rating,
                v.review_count,
                va.latitude,
                va.longitude
            FROM vendor_products vp
            JOIN vendors v ON vp.vendor_id = v.id
            JOIN users u ON v.user_id = u.id
            LEFT JOIN addresses va ON v.user_id = va.user_id
            WHERE vp.product_id = $1
              AND vp.is_active = true
              AND v.approval_status = 'approved'
              AND v.is_active = true
              AND v.is_blocked = false
              AND u.is_active = true
        `;
        const result = await pool.query(query, [productId]);

        const vendors = result.rows.map((row) => {
            const price = Number(row.price) || 0;
            const rating = Number(row.rating) || 0;
            const reviewCount = Number(row.review_count) || 0;
            const vendorLat = row.latitude !== null ? Number(row.latitude) : null;
            const vendorLng = row.longitude !== null ? Number(row.longitude) : null;

            let distance: number | null = null;
            if (vendorLat !== null && vendorLng !== null) {
                distance = haversineDistance(parsedLat, parsedLng, vendorLat, vendorLng);
            }

            return {
                vendor_id: row.vendor_id,
                price,
                moq: row.moq,
                stock_quantity: row.stock_quantity,
                rating,
                review_count: reviewCount,
                latitude: vendorLat,
                longitude: vendorLng,
                distance,
            };
        });

        if (vendors.length === 0) {
            return res.status(200).json({ message: "No vendors found", data: [] });
        }

        const prices = vendors.map((v) => v.price).filter((p) => p > 0);
        const distances = vendors.map((v) => v.distance).filter((d): d is number => d !== null);
        const ratings = vendors.map((v) => v.rating);

        const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
        const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
        const minDist = distances.length > 0 ? Math.min(...distances) : 0;
        const maxDist = distances.length > 0 ? Math.max(...distances) : 0;
        const maxRating = ratings.length > 0 ? Math.max(...ratings) : 5;

        const PRICE_WEIGHT = 0.4;
        const DISTANCE_WEIGHT = 0.4;
        const REVIEW_WEIGHT = 0.2;

        const scoredVendors = vendors.map((v) => {
            const priceScore = maxPrice > minPrice ? (maxPrice - v.price) / (maxPrice - minPrice) : 1;
            const distanceScore = v.distance !== null && maxDist > minDist
                ? (maxDist - v.distance) / (maxDist - minDist)
                : v.distance !== null ? 1 : 0.5;
            const reviewScore = maxRating > 0 ? v.rating / maxRating : 0;

            const totalScore = (PRICE_WEIGHT * priceScore) + (DISTANCE_WEIGHT * distanceScore) + (REVIEW_WEIGHT * reviewScore);

            return {
                ...v,
                price_score: Math.round(priceScore * 100) / 100,
                distance_score: Math.round(distanceScore * 100) / 100,
                review_score: Math.round(reviewScore * 100) / 100,
                total_score: Math.round(totalScore * 100) / 100,
            };
        });

        scoredVendors.sort((a, b) => b.total_score - a.total_score);

        scoredVendors.forEach((v, index) => {
            (v as any).rank = index + 1;
        });

        return res.status(200).json({ message: "Ranked vendors fetched successfully", data: scoredVendors });
    } catch (e) {
        console.log("Error while ranking vendors : ", e);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};

export const getVendorProductByIdController = async (req: Request, res: Response): Promise<Response> => {
    const { productId } = req.params;
    const { userId, role } = (req as any).user;

    if (!productId) {
        return res.status(400).json({ message: "Product ID is required" });
    }

    if (role !== "vendor") {
        return res.status(403).json({ message: "Unauthorized! Only vendors can access their products." });
    }

    try {
        const vendorResult = await pool.query(
            `SELECT id, approval_status, is_active, is_blocked FROM vendors WHERE user_id = $1`,
            [userId]
        );

        if (vendorResult.rows.length === 0) {
            return res.status(403).json({ message: "Vendor profile not found." });
        }

        const vendor = vendorResult.rows[0];
        const vendorId = vendor.id;

        const query = `
            SELECT 
                p.id AS product_id,
                p.name AS product_name,
                p.description,
                p.category,
                p.product_type,
                p.material,
                p.grade,
                p.application,
                p.standard,
                vp.price,
                vp.moq,
                vp.stock_quantity,
                vp.is_active,
                vp.status,
                vp.created_at AS vendor_product_created_at,
                vp.updated_at AS vendor_product_updated_at,
                ${approvedSpecificationsSelect},
                COALESCE(
                    JSON_AGG(
                        JSONB_BUILD_OBJECT(
                            'image_url', pImg.image_url,
                            'is_primary', pImg.is_primary,
                            'display_order', pImg.display_order
                        )
                        ORDER BY pImg.display_order
                    ) FILTER (WHERE pImg.id IS NOT NULL),
                    '[]'::json
                ) AS images
            FROM vendor_products vp
            JOIN products p ON vp.product_id = p.id
            ${approvedSpecificationsJoin}
            LEFT JOIN products_images pImg ON p.id = pImg.product_id
            WHERE vp.vendor_id = $1 AND vp.product_id = $2
            GROUP BY p.id, vp.price, vp.moq, vp.stock_quantity, vp.is_active, vp.status, 
                     vp.created_at, vp.updated_at, specAgg.specifications
        `;

        const result = await pool.query(query, [vendorId, productId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Product not found or you don't have access to this product." });
        }

        return res.status(200).json({ 
            message: "Vendor product fetched successfully", 
            data: result.rows[0] 
        });
    } catch (error) {
        console.error("Error while fetching vendor product:", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};

export const updateVendorProductController = async (req: Request, res: Response): Promise<Response> => {
    const { productId } = req.params;
    const { price, moq, stockQuantity, isActive } = req.body;
    const { userId, role } = (req as any).user;

    if (!productId) {
        return res.status(400).json({ message: "Product ID is required" });
    }

    if (price === undefined || moq === undefined || stockQuantity === undefined || isActive === undefined) {
        return res.status(400).json({ message: "Price, MOQ, stock quantity, and active status are required" });
    }

    if (role !== "vendor") {
        return res.status(403).json({ message: "Unauthorized! Only vendors can update their products." });
    }

    try {
        const vendorResult = await pool.query(
            `SELECT id, approval_status, is_active, is_blocked FROM vendors WHERE user_id = $1`,
            [userId]
        );

        if (vendorResult.rows.length === 0) {
            return res.status(403).json({ message: "Vendor profile not found." });
        }

        const vendor = vendorResult.rows[0];
        if (vendor.approval_status !== "approved" || !vendor.is_active || vendor.is_blocked) {
            return res.status(403).json({ message: "Your vendor account must be approved and active to update products." });
        }

        const vendorId = vendor.id;

        // Check if the vendor product exists
        const existingProductResult = await pool.query(
            `SELECT id FROM vendor_products WHERE vendor_id = $1 AND product_id = $2`,
            [vendorId, productId]
        );

        if (existingProductResult.rows.length === 0) {
            return res.status(404).json({ message: "Product not found or you don't have access to this product." });
        }

        // Update the vendor product
        const updateQuery = `
            UPDATE vendor_products 
            SET price = $1, moq = $2, stock_quantity = $3, is_active = $4, updated_at = NOW()
            WHERE vendor_id = $5 AND product_id = $6
            RETURNING *
        `;

        const result = await pool.query(updateQuery, [
            Number(price),
            Number(moq),
            Number(stockQuantity),
            Boolean(isActive),
            vendorId,
            productId
        ]);

        return res.status(200).json({ 
            message: "Vendor product updated successfully", 
            data: result.rows[0] 
        });
    } catch (error) {
        console.error("Error while updating vendor product:", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};

export const getVendorProductAnalyticsController = async (req: Request, res: Response): Promise<Response> => {
    const { productId } = req.params;
    const { userId, role } = (req as any).user;

    if (!productId) {
        return res.status(400).json({ message: "Product ID is required" });
    }

    if (role !== "vendor") {
        return res.status(403).json({ message: "Unauthorized! Only vendors can access their product analytics." });
    }

    try {
        const vendorResult = await pool.query(
            `SELECT id, approval_status, is_active, is_blocked FROM vendors WHERE user_id = $1`,
            [userId]
        );

        if (vendorResult.rows.length === 0) {
            return res.status(403).json({ message: "Vendor profile not found." });
        }

        const vendor = vendorResult.rows[0];
        const vendorId = vendor.id;

        // Get basic analytics
        const analyticsQuery = `
            SELECT 
                vp.price,
                vp.moq,
                vp.stock_quantity,
                vp.is_active,
                vp.created_at AS vendor_product_created_at,
                vp.updated_at AS vendor_product_updated_at,
                p.name AS product_name,
                p.category,
                p.product_type,
                p.rating AS product_rating,
                p.review_count AS total_reviews,
                
                -- Order statistics
                COALESCE(order_stats.total_orders, 0)::int AS total_orders,
                COALESCE(order_stats.total_revenue, 0)::numeric AS total_revenue,
                COALESCE(order_stats.avg_order_value, 0)::numeric AS avg_order_value,
                COALESCE(order_stats.last_order_date, NULL) AS last_order_date,
                
                -- View statistics (simulated - you might want to add a views table)
                COALESCE(view_stats.total_views, 0)::int AS total_views,
                COALESCE(view_stats.unique_views, 0)::int AS unique_views,
                
                -- Cart statistics
                COALESCE(cart_stats.cart_additions, 0)::int AS cart_additions,
                COALESCE(cart_stats.conversion_rate, 0)::numeric AS conversion_rate
                
            FROM vendor_products vp
            JOIN products p ON vp.product_id = p.id
            LEFT JOIN LATERAL (
                SELECT 
                    COUNT(DISTINCT oi.order_id)::int AS total_orders,
                    COALESCE(SUM(oi.quantity * oi.price), 0)::numeric AS total_revenue,
                    COALESCE(AVG(oi.quantity * oi.price), 0)::numeric AS avg_order_value,
                    MAX(o.created_at) AS last_order_date
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                WHERE oi.product_id = vp.product_id 
                  AND oi.vendor_id = vp.vendor_id
                  AND o.status NOT IN ('cancelled', 'refunded')
            ) order_stats ON true
            
            LEFT JOIN LATERAL (
                SELECT 
                    0::int AS total_views,  -- Placeholder - implement views tracking
                    0::int AS unique_views   -- Placeholder - implement unique views tracking
            ) view_stats ON true
            
            LEFT JOIN LATERAL (
                SELECT 
                    COUNT(DISTINCT c.user_id)::int AS cart_additions,
                    CASE 
                        WHEN COUNT(DISTINCT oi.order_id) > 0 
                        THEN (COUNT(DISTINCT oi.order_id)::numeric / NULLIF(COUNT(DISTINCT c.user_id), 0)) * 100
                        ELSE 0 
                    END::numeric AS conversion_rate
                FROM cart_items ci
                JOIN carts c ON ci.cart_id = c.id
                LEFT JOIN order_items oi ON ci.product_id = oi.product_id AND ci.vendor_id = oi.vendor_id
                WHERE ci.product_id = vp.product_id AND ci.vendor_id = vp.vendor_id
            ) cart_stats ON true
            
            WHERE vp.vendor_id = $1 AND vp.product_id = $2
        `;

        const analyticsResult = await pool.query(analyticsQuery, [vendorId, productId]);

        if (analyticsResult.rows.length === 0) {
            return res.status(404).json({ message: "Product not found or you don't have access to this product." });
        }

        const analytics = analyticsResult.rows[0];

        // Get monthly sales data for the last 6 months
        const monthlySalesQuery = `
            SELECT 
                DATE_TRUNC('month', o.created_at)::date AS month,
                COUNT(DISTINCT oi.order_id)::int AS orders_count,
                COALESCE(SUM(oi.quantity * oi.price), 0)::numeric AS revenue,
                COALESCE(SUM(oi.quantity), 0)::int AS quantity_sold
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE oi.product_id = $1 
              AND oi.vendor_id = $2
              AND o.status NOT IN ('cancelled', 'refunded')
              AND o.created_at >= NOW() - INTERVAL '6 months'
            GROUP BY DATE_TRUNC('month', o.created_at)
            ORDER BY month DESC
        `;

        const monthlySalesResult = await pool.query(monthlySalesQuery, [productId, vendorId]);

        // Get recent orders
        const recentOrdersQuery = `
            SELECT 
                o.id AS order_id,
                o.created_at AS order_date,
                o.total_amount,
                o.status AS order_status,
                oi.quantity,
                oi.price AS unit_price,
                oi.quantity * oi.price AS total_price,
                u.name AS customer_name,
                u.email AS customer_email
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN users u ON o.user_id = u.id
            WHERE oi.product_id = $1 
              AND oi.vendor_id = $2
            ORDER BY o.created_at DESC
            LIMIT 10
        `;

        const recentOrdersResult = await pool.query(recentOrdersQuery, [productId, vendorId]);

        return res.status(200).json({ 
            message: "Vendor product analytics fetched successfully", 
            data: {
                ...analytics,
                monthly_sales: monthlySalesResult.rows,
                recent_orders: recentOrdersResult.rows
            }
        });
    } catch (error) {
        console.error("Error while fetching vendor product analytics:", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};

export const getProductReviewsController = async (req: Request, res: Response): Promise<Response> => {
    const { productId } = req.params;
    const { userId, role } = (req as any).user;
    const { offset = "0", limit = "10" } = req.query;

    if (!productId) {
        return res.status(400).json({ message: "Product ID is required" });
    }

    if (role !== "vendor") {
        return res.status(403).json({ message: "Unauthorized! Only vendors can access their product reviews." });
    }

    try {
        const vendorResult = await pool.query(
            `SELECT id, approval_status, is_active, is_blocked FROM vendors WHERE user_id = $1`,
            [userId]
        );

        if (vendorResult.rows.length === 0) {
            return res.status(403).json({ message: "Vendor profile not found." });
        }

        const vendor = vendorResult.rows[0];
        const vendorId = vendor.id;

        // Check if vendor has access to this product
        const productAccessResult = await pool.query(
            `SELECT id FROM vendor_products WHERE vendor_id = $1 AND product_id = $2`,
            [vendorId, productId]
        );

        if (productAccessResult.rows.length === 0) {
            return res.status(404).json({ message: "Product not found or you don't have access to this product." });
        }

        const offsetValue = Number(offset) * Number(limit);
        const limitValue = Math.min(Number(limit), 50); // Max 50 reviews per page

        // Get reviews with pagination
        const reviewsQuery = `
            SELECT 
                oir.id AS review_id,
                oir.rating,
                oir.review_title,
                oir.review_text,
                oir.created_at AS review_date,
                u.name AS customer_name,
                u.email AS customer_email,
                o.id AS order_id,
                o.created_at AS order_date,
                oi.quantity AS purchased_quantity,
                oi.price AS unit_price,
                CASE 
                    WHEN oir.rating >= 5 THEN 'Excellent'
                    WHEN oir.rating >= 4 THEN 'Good'
                    WHEN oir.rating >= 3 THEN 'Average'
                    WHEN oir.rating >= 2 THEN 'Poor'
                    ELSE 'Very Poor'
                END AS rating_label
            FROM order_item_reviews oir
            JOIN order_items oi ON oir.order_item_id = oi.id
            JOIN orders o ON oi.order_id = o.id
            JOIN users u ON oir.user_id = u.id
            WHERE oi.product_id = $1 
              AND oi.vendor_id = $2
            ORDER BY oir.created_at DESC
            LIMIT $3 OFFSET $4
        `;

        const reviewsResult = await pool.query(reviewsQuery, [productId, vendorId, limitValue, offsetValue]);

        // Get review statistics
        const statsQuery = `
            SELECT 
                COUNT(*)::int AS total_reviews,
                COALESCE(AVG(rating), 0)::numeric AS avg_rating,
                COUNT(CASE WHEN rating = 5 THEN 1 END)::int AS five_star_count,
                COUNT(CASE WHEN rating = 4 THEN 1 END)::int AS four_star_count,
                COUNT(CASE WHEN rating = 3 THEN 1 END)::int AS three_star_count,
                COUNT(CASE WHEN rating = 2 THEN 1 END)::int AS two_star_count,
                COUNT(CASE WHEN rating = 1 THEN 1 END)::int AS one_star_count
            FROM order_item_reviews oir
            JOIN order_items oi ON oir.order_item_id = oi.id
            WHERE oi.product_id = $1 
              AND oi.vendor_id = $2
        `;

        const statsResult = await pool.query(statsQuery, [productId, vendorId]);

        const stats = statsResult.rows[0];

        return res.status(200).json({ 
            message: "Product reviews fetched successfully", 
            data: {
                reviews: reviewsResult.rows,
                stats: {
                    total_reviews: stats.total_reviews,
                    avg_rating: Number(stats.avg_rating).toFixed(1),
                    rating_distribution: {
                        5: stats.five_star_count,
                        4: stats.four_star_count,
                        3: stats.three_star_count,
                        2: stats.two_star_count,
                        1: stats.one_star_count
                    }
                },
                pagination: {
                    current_page: Number(offset),
                    per_page: limitValue,
                    has_more: reviewsResult.rows.length === limitValue
                }
            }
        });
    } catch (error) {
        console.error("Error while fetching product reviews:", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};

export const getRelatedProducts = async (req: Request, res: Response): Promise<Response> => {
    const { productId } = req.params;
    if (!productId) {
        return res.status(400).json({ message: "Product ID is required" });
    }

    try {
        const query = `
            SELECT
                p.id AS product_id,
                p.name AS product_name,
                p.category,
                p.product_type,
                p.material,
                p.grade,
                p.rating,
                p.review_count,
                pImg.image_url AS primary_image,
                COALESCE(vc.vendor_count, 0)::int AS seller_count,
                COALESCE(pr.min_price, 0)::numeric AS min_price,
                COALESCE(pr.max_price, 0)::numeric AS max_price,
                COALESCE(pr.min_moq, 1)::int AS min_moq
            FROM products p
            LEFT JOIN products_images pImg
                ON p.id = pImg.product_id AND pImg.is_primary = true
            LEFT JOIN LATERAL (
                SELECT COUNT(DISTINCT vendor_id)::int AS vendor_count
                FROM vendor_products vp
                JOIN vendors v ON v.id = vp.vendor_id
                JOIN users u ON u.id = v.user_id
                WHERE vp.product_id = p.id
                  AND vp.is_active = true
                  AND v.approval_status = 'approved'
                  AND v.is_active = true
                  AND v.is_blocked = false
                  AND u.is_active = true
            ) vc ON true
            LEFT JOIN LATERAL (
                SELECT
                    MIN(price)::numeric AS min_price,
                    MAX(price)::numeric AS max_price,
                    MIN(moq)::int AS min_moq
                FROM vendor_products vp
                JOIN vendors v ON v.id = vp.vendor_id
                JOIN users u ON u.id = v.user_id
                WHERE vp.product_id = p.id
                  AND vp.is_active = true
                  AND v.approval_status = 'approved'
                  AND v.is_active = true
                  AND v.is_blocked = false
                  AND u.is_active = true
            ) pr ON true
            WHERE p.approval_status = 'approved'
              AND p.is_active = TRUE
              AND p.id != $1
              AND p.category = (SELECT category FROM products WHERE id = $1)
            ORDER BY p.rating DESC NULLS LAST, p.review_count DESC NULLS LAST, p.created_at DESC
            LIMIT 8
        `;
        const result = await pool.query(query, [productId]);
        return res.status(200).json({ message: "Related products fetched successfully", data: result.rows });
    } catch (e) {
        console.log("Error while fetching related products : ", e);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};
