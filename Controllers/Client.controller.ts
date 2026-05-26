import type { Request, Response } from "express"
import pool from "../DbConnect";

function normalizeRequiredText(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function composeAddress(
    addressLine1: string,
    addressLine2: string,
    landmark: string,
    fallbackAddress: string,
) {
    const addressParts = [addressLine1, addressLine2, landmark].filter(Boolean);
    if (addressParts.length > 0) {
        return addressParts.join(", ");
    }

    return fallbackAddress.trim();
}


export const addClientDetailsController = async (req: Request, res: Response): Promise<Response> => {
    const { phone, address, addressLine1, addressLine2, landmark, addressPhone, city, state, country, pincode, latitude, longitude} = req.body;
    const authUser = (req as any).user;

    if (!authUser?.userId || !authUser?.role) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { userId, role } = authUser;

    const normalizedPhone = normalizeRequiredText(phone);
    const normalizedAddressLine1 = normalizeRequiredText(addressLine1) || normalizeRequiredText(address);
    const normalizedAddressLine2 = normalizeRequiredText(addressLine2);
    const normalizedLandmark = normalizeRequiredText(landmark);
    const normalizedAddressPhone = normalizeRequiredText(addressPhone);
    const normalizedCity = normalizeRequiredText(city);
    const normalizedState = normalizeRequiredText(state);
    const normalizedCountry = normalizeRequiredText(country);
    const normalizedPincode = normalizeRequiredText(pincode);
    const normalizedCombinedAddress = composeAddress(
        normalizedAddressLine1,
        normalizedAddressLine2,
        normalizedLandmark,
        normalizedAddressLine1,
    );

    if (
        !userId ||
        !normalizedPhone ||
        !normalizedAddressLine1 ||
        !normalizedAddressPhone ||
        !normalizedCity ||
        !normalizedState ||
        !normalizedCountry ||
        !normalizedPincode ||
        latitude === undefined ||
        longitude === undefined
    ) {
        return res.status(400).json({ message: "All fields are required!" });
    }

    if (role != 'client')
        return res.status(403).json({ message: "Unauthorized! Only clients can add addresses!" });

    try {
        const clientQuery = await pool.query(`
            SELECT u.id, c.id as client_id, a.id as address_id 
            FROM users u
            LEFT JOIN client c ON u.id = c.user_id
            LEFT JOIN addresses a ON u.id = a.user_id
            WHERE u.id = $1 AND u.role = 'client' AND u.is_active = true
        `, [userId]);

        if (clientQuery.rows.length === 0) {
            return res.status(404).json({ message: "Client not found or not active!" });
        }

        const { client_id, address_id } = clientQuery.rows[0];

        if (client_id && address_id) {
            return res.status(400).json({ message: "Client details already exist. You can update them, but cannot add again." });
        }

        // Use a transaction since we are inserting into multiple tables
        await pool.query('BEGIN');

        let newAddress = null;

        if (!address_id) {
            const addressResult = await pool.query(
                `INSERT INTO addresses (
                    user_id,
                    address,
                    address_line1,
                    address_line2,
                    landmark,
                    address_phone,
                    city,
                    state,
                    country,
                    pincode,
                    latitude,
                    longitude
                )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
                [
                    userId,
                    normalizedCombinedAddress,
                    normalizedAddressLine1,
                    normalizedAddressLine2 || null,
                    normalizedLandmark || null,
                    normalizedAddressPhone,
                    normalizedCity,
                    normalizedState,
                    normalizedCountry,
                    normalizedPincode,
                    latitude,
                    longitude,
                ]
            );
            newAddress = addressResult.rows[0];
        }

        if (!client_id) {
            await pool.query(
                `INSERT INTO client (user_id, phone) VALUES ($1, $2)`,
                [userId, phone]
            );
        } else {
            await pool.query(
                `UPDATE client SET phone = $1, updated_at = NOW() WHERE user_id = $2`,
                [phone, userId]
            );
        }

        await pool.query('COMMIT');

        return res.status(201).json({ message: "Client details added successfully!", address: newAddress });
    }
    catch (e) {
        await pool.query('ROLLBACK');
        console.error("Error occurred while adding client details: ", e);
        return res.status(500).json({ message: "Error occurred while adding client details!" });
    }
}

export const updateClientAddressController = async (req: Request, res: Response): Promise<Response> => {
    const { address, addressLine1, addressLine2, landmark, addressPhone, city, state, country, pincode, latitude, longitude } = req.body;
    const authUser = (req as any).user;

    if (!authUser?.userId || !authUser?.role) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { userId, role } = authUser;

    if (role != 'client')
        return res.status(403).json({ message: "Unauthorized! Only clients can update their address!" });

    try {
        const normalizedPhone = normalizeRequiredText(addressPhone);
        const normalizedAddressLine1 = normalizeRequiredText(addressLine1) || normalizeRequiredText(address);
        const normalizedAddressLine2 = normalizeRequiredText(addressLine2);
        const normalizedLandmark = normalizeRequiredText(landmark);
        const normalizedCity = normalizeRequiredText(city);
        const normalizedState = normalizeRequiredText(state);
        const normalizedCountry = normalizeRequiredText(country);
        const normalizedPincode = normalizeRequiredText(pincode);

        const doesUserClientExist = await pool.query(
            `SELECT id FROM users WHERE id = $1 AND role = 'client' AND is_active = true`,
            [userId]
        );

        if (doesUserClientExist.rows.length === 0) {
            return res.status(404).json({ message: "Client not found or not active!" });
        }

        const doesAddressExists = await pool.query(
            `SELECT * FROM addresses WHERE user_id = $1`,
            [userId]
        );
        if (doesAddressExists.rows.length === 0) {
            return res.status(404).json({ message: "Address not found!" });
        }

        const currentAddress = doesAddressExists.rows[0];
        const finalAddressLine1 = normalizedAddressLine1 || currentAddress.address_line1 || normalizeRequiredText(currentAddress.address);
        const finalAddressLine2 = normalizedAddressLine2 || currentAddress.address_line2 || "";
        const finalLandmark = normalizedLandmark || currentAddress.landmark || "";
        const finalAddressPhone = normalizedPhone || currentAddress.address_phone || "";
        const finalAddress = composeAddress(
            finalAddressLine1,
            finalAddressLine2,
            finalLandmark,
            normalizeRequiredText(currentAddress.address),
        );

        if (
            !finalAddress ||
            !normalizedCity ||
            !normalizedState ||
            !normalizedCountry ||
            !normalizedPincode ||
            latitude === undefined ||
            longitude === undefined
        ) {
            return res.status(400).json({ message: "All fields are required!" });
        }

        const result = await pool.query(
            `UPDATE addresses 
             SET address = $1,
                 address_line1 = $2,
                 address_line2 = $3,
                 landmark = $4,
                 address_phone = $5,
                 city = $6,
                 state = $7,
                 country = $8,
                 pincode = $9,
                 latitude = $10,
                 longitude = $11,
                 updated_at = NOW() 
             WHERE user_id = $12 RETURNING *`,
            [finalAddress, finalAddressLine1, finalAddressLine2 || null, finalLandmark || null, finalAddressPhone, normalizedCity, normalizedState, normalizedCountry, normalizedPincode, latitude, longitude, userId]
        );
        const updatedAddress = result.rows[0];
        return res.status(200).json({ message: "Client address updated successfully!", address: updatedAddress });
    }
    catch (e) {
        console.error("Error occurred while updating client address: ", e);
        return res.status(500).json({ message: "Error occurred while updating client address!" });
    }
}

export const updateClientNumberController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;

    if (!authUser?.userId || !authUser?.role) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { userId, role } = authUser;
    if (role != 'client')
        return res.status(403).json({ message: "Unauthorized! Only clients can update their phone number!" });

    if (!userId)
        return res.status(400).json({ message: "User ID is required!" });

    const { phone } = req.body;
    const normalizedPhone = typeof phone === "string" ? phone.trim() : "";

    if (!normalizedPhone)
        return res.status(400).json({ message: "Phone number is required to update!" });

    try {
        const doesUserClientExist = await pool.query(
            `SELECT id FROM users WHERE id = $1 AND role = 'client' AND is_active = true`,
            [userId]
        );

        if (doesUserClientExist.rows.length === 0) {
            return res.status(404).json({ message: "Client not found or not active!" });
        }

        const updateResult = await pool.query(
            `UPDATE client
             SET phone = $1,
                 updated_at = NOW()
             WHERE user_id = $2
             RETURNING *`,
            [normalizedPhone, userId]
        );

        if (updateResult.rows.length === 0) {
            return res.status(404).json({ message: "Client details not found. Please add them first." });
        }

        return res.status(200).json({ message: "Client phone updated successfully!", client: updateResult.rows[0] });
    }
    catch (e) {
        console.error("Error occurred while updating client phone: ", e);
        return res.status(500).json({ message: "Error occurred while updating client phone!" });
    }
}

export const clientDetails = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;

    if (!authUser?.userId || !authUser?.role) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { userId, role } = authUser;

    if (!userId || !role)
        return res.status(400).json({ message: "Required all field" });


    try {
        const profileResult = await pool.query(
            `
                SELECT 
                    u.id AS user_id, 
                    u.name AS user_name, 
                    u.email, 
                    u.is_active,
                    c.phone
                FROM users u
                LEFT JOIN client c ON u.id = c.user_id
                WHERE u.id = $1 AND u.role = 'client'
            `,
            [userId]
        );

        if (profileResult.rows.length === 0) {
            return res.status(404).json({ message: "Client not found." });
        }

        const addressesResult = await pool.query(
            `
                SELECT
                    id,
                    user_id,
                    address,
                    address_line1,
                    address_line2,
                    landmark,
                    address_phone,
                    city,
                    state,
                    country,
                    pincode,
                    latitude,
                    longitude,
                    created_at,
                    updated_at
                FROM addresses
                WHERE user_id = $1
                ORDER BY created_at DESC
            `,
            [userId]
        );

        return res.status(200).json({ 
            message: "Client details fetched successfully",
            data: {
                ...profileResult.rows[0],
                addresses: addressesResult.rows,
                primary_address: addressesResult.rows[0] || null,
            }
        });
    }
    catch (e) {
        console.error("Error : ", e);
        return res.status(500).json({ message: 'internal server error' });
    }
}

export const upsertClientAddressController = async (req: Request, res: Response): Promise<Response> => {
    const { address, addressLine1, addressLine2, landmark, addressPhone, city, state, country, pincode, latitude, longitude, addressId } = req.body;
    const authUser = (req as any).user;

    if (!authUser?.userId || !authUser?.role) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { userId, role } = authUser;

    if (role != 'client')
        return res.status(403).json({ message: "Unauthorized! Only clients can add/update addresses!" });

    try {
        const normalizedPhone = normalizeRequiredText(addressPhone);
        const normalizedAddressLine1 = normalizeRequiredText(addressLine1) || normalizeRequiredText(address);
        const normalizedAddressLine2 = normalizeRequiredText(addressLine2);
        const normalizedLandmark = normalizeRequiredText(landmark);
        const normalizedCity = normalizeRequiredText(city);
        const normalizedState = normalizeRequiredText(state);
        const normalizedCountry = normalizeRequiredText(country);
        const normalizedPincode = normalizeRequiredText(pincode);
        const isEditingAddress = typeof addressId === "string" && addressId.trim().length > 0;
        const existingAddressResult = addressId
            ? await pool.query(
                `SELECT * FROM addresses WHERE id = $1 AND user_id = $2`,
                [addressId, userId]
            )
            : await pool.query(
                `SELECT * FROM addresses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
                [userId]
            );

        const currentAddress = existingAddressResult.rows[0] || null;
        if (isEditingAddress && !currentAddress) {
            return res.status(404).json({ message: "Address not found!" });
        }

        const finalAddressLine1 = normalizedAddressLine1 || currentAddress?.address_line1 || normalizeRequiredText(currentAddress?.address);
        const finalAddressLine2 = normalizedAddressLine2 || currentAddress?.address_line2 || "";
        const finalLandmark = normalizedLandmark || currentAddress?.landmark || "";
        const finalAddressPhone = normalizedPhone || currentAddress?.address_phone || "";
        const finalAddress = composeAddress(
            finalAddressLine1,
            finalAddressLine2,
            finalLandmark,
            normalizeRequiredText(currentAddress?.address) || normalizedAddressLine1,
        );

        if (
            !finalAddress ||
            !normalizedCity ||
            !normalizedState ||
            !normalizedCountry ||
            !normalizedPincode ||
            latitude === undefined ||
            longitude === undefined
        ) {
            return res.status(400).json({ message: "All address fields are required!" });
        }

        let result;
        if (isEditingAddress) {
            result = await pool.query(
                `UPDATE addresses
                 SET address = $1,
                     address_line1 = $2,
                     address_line2 = $3,
                     landmark = $4,
                     address_phone = $5,
                     city = $6,
                     state = $7,
                     country = $8,
                     pincode = $9,
                     latitude = $10,
                     longitude = $11,
                     updated_at = NOW()
                 WHERE id = $12 AND user_id = $13 RETURNING *`,
                [finalAddress, finalAddressLine1, finalAddressLine2 || null, finalLandmark || null, finalAddressPhone, normalizedCity, normalizedState, normalizedCountry, normalizedPincode, latitude, longitude, addressId, userId]
            );
        } else {
            result = await pool.query(
                `INSERT INTO addresses (
                    user_id,
                    address,
                    address_line1,
                    address_line2,
                    landmark,
                    address_phone,
                    city,
                    state,
                    country,
                    pincode,
                    latitude,
                    longitude
                )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
                [userId, finalAddress, finalAddressLine1, finalAddressLine2 || null, finalLandmark || null, finalAddressPhone, normalizedCity, normalizedState, normalizedCountry, normalizedPincode, latitude, longitude]
            );
        }

        return res.status(200).json({
            message: isEditingAddress ? "Address updated successfully!" : "Address added successfully!",
            address: result.rows[0]
        });
    }
    catch (e) {
        console.error("Error occurred while upserting client address: ", e);
        return res.status(500).json({ message: "Error occurred while saving address!" });
    }
}

export const getClientAddressByIdController = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;

    if (!authUser?.userId || !authUser?.role) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    if (authUser.role !== "client") {
        return res.status(403).json({ message: "Unauthorized! Only clients can view addresses!" });
    }

    const { addressId } = req.params;

    if (!addressId) {
        return res.status(400).json({ message: "Address ID is required" });
    }

    try {
        const result = await pool.query(
            `SELECT * FROM addresses WHERE id = $1 AND user_id = $2`,
            [addressId, authUser.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Address not found" });
        }

        return res.status(200).json({ message: "Address fetched successfully", address: result.rows[0] });
    } catch (error) {
        console.error("Error fetching client address:", error);
        return res.status(500).json({ message: "Error occurred while fetching address!" });
    }
}

export const checkClientSetupStatus = async (req: Request, res: Response): Promise<Response> => {
    const authUser = (req as any).user;
    if (!authUser?.userId) return res.status(401).json({ message: "Unauthorized" });

    try {
        const query = `
            SELECT 
                EXISTS(SELECT 1 FROM client WHERE user_id = $1) AS has_client,
                EXISTS(SELECT 1 FROM addresses WHERE user_id = $1) AS has_address
        `;
        const result = await pool.query(query, [authUser.userId]);
        const isSetupComplete = Boolean(result.rows[0]?.has_client) && Boolean(result.rows[0]?.has_address);
        return res.status(200).json({ isSetupComplete });
    } catch (e) {
        return res.status(500).json({ message: "Error" });
    }
}