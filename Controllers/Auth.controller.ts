import type { Request, Response } from "express";
import bcrypt from 'bcrypt';
import type { DatabaseError } from 'pg';
import { generateAccessToken, generateRefreshToken, verifyToken } from "../helpers/jwt.helper";
import pool from "../DbConnect";
import { COOKIE_OPTIONS } from "../shared/CokkieSetting.shared";

const validUserRoles = new Set(["client", "vendor", "admin", "super_admin"]);

export async function registerUser(req: Request, res: Response): Promise<Response> {

    const { name, email, password, role: requestedRole } = req.body;
    const role = typeof requestedRole === "string" && requestedRole.trim() ? requestedRole.trim() : "client";

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    if (!/^[\w.-]+@[\w.-]+\.\w{2,}$/.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!validUserRoles.has(role)) {
        return res.status(400).json({ message: 'Invalid role' });
    }

    try {
        // Check if user already exists
        const existingUserResult = await pool.query('SELECT id, is_verified FROM users WHERE email = $1', [email]);

        if (existingUserResult.rows.length > 0) {
            const existingUser = existingUserResult.rows[0];

            if (existingUser.is_verified) {
                return res.status(409).json({ message: 'User with this email already exists' });
            }

            // User exists but is not verified — update details and resend OTP

            const hashedPassword = await bcrypt.hash(password, 10);
            await pool.query(
                'UPDATE users SET name = $1, password_hash = $2, role = $3 WHERE id = $4',
                [name, hashedPassword, role, existingUser.id]
            );

            // Generate new OTP
            const plainOTP = Math.floor(100000 + Math.random() * 900000).toString();
            const hashedOTP = await bcrypt.hash(plainOTP, 10);
            const expiryTime = new Date(Date.now() + 10 * 60 * 1000);

            await pool.query(
                'UPDATE users SET OTP = $1, OTP_Expiry = $2 WHERE id = $3',
                [hashedOTP, expiryTime, existingUser.id]
            );

            console.log(`OTP for ${email}: ${plainOTP}`);

            return res.status(200).json({
                message: 'OTP sent to your email. Please verify to complete registration.',
                email: email,
                expiresAt: expiryTime.toISOString()
            });
        }

        // New user — create with is_verified = false
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (name, email, password_hash, role, is_verified) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email',
            [name, email, hashedPassword, role, false]
        );

        const user = result.rows[0];
        // Generate OTP
        const plainOTP = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedOTP = await bcrypt.hash(plainOTP, 10);
        const expiryTime = new Date(Date.now() + 10 * 60 * 1000);

        await pool.query(
            'UPDATE users SET OTP = $1, OTP_Expiry = $2 WHERE id = $3',
            [hashedOTP, expiryTime, user.id]
        );

        console.log(`OTP for ${email}: ${plainOTP}`);

        return res.status(200).json({
            message: 'Registration initiated. OTP sent to your email.',
            email: email,
            expiresAt: expiryTime.toISOString()
        });
    }
    catch (error) {
        const dbError = error as DatabaseError;
        if (dbError.code === '23505') {
            return res.status(409).json({ message: 'User with this email already exists' });
        }
        console.error('Error registering user:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}


export async function loginUser(req: Request, res: Response): Promise<Response> {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
        return res.status(400).json({ message: 'Email, password, and role are required' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ message: 'Invalid email' });
        }

        if(user.role != role)
            return res.status(401).json({ message: `This email is associated with ${user.role} and you are trying to log in as ${role}! That is not allowed.` });

        const isPasswordValid = await bcrypt.compare(password, user.password_hash);

        if (!isPasswordValid) {

            return res.status(401).json({ message: 'Invalid password' });

        }

        const refreshToken = generateRefreshToken(user.id, user.name, user.email, user.role);

        const accessToken = generateAccessToken(user.id, user.name, user.email, user.role);

        // Store refresh token in database for revocation and session tracking
        await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

        res.cookie(`${user.role}RefreshToken`, refreshToken, {
            ...COOKIE_OPTIONS,
            maxAge: 45 * 24 * 60 * 60 * 1000, // 45 days
        });

        res.cookie(`${user.role}AccessToken`, accessToken, {
            ...COOKIE_OPTIONS,
            maxAge: 30 * 60 * 1000, // 30 minutes
        });


        return res.status(200).json({ message: 'Login successful', user: { userId: user.id, username: user.name, email: user.email, role: user.role } });

    }
    catch (error) {
        console.error('Error logging in user:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

export async function getCurrentUser(req: Request, res: Response): Promise<Response> {
    const user = (req as any).user;
    if (!user) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    return res.status(200).json({ user: { userId: user.userId, username: user.username, email: user.email, role: user.role } });
}

export async function logoutUser(req: Request, res: Response): Promise<Response> {
    const isRequestFrom = req.headers['x-request-from'] || '';
    const refreshToken = req.cookies[`${isRequestFrom}RefreshToken`];
    
    if (!refreshToken) {
        return res.status(400).json({ message: 'Refresh token is required' });
    }
    try {
        const isVerified = verifyToken(refreshToken, 'refresh');
        if (!isVerified) {
            return res.status(401).json({ message: 'Invalid refresh token' });
        }

        // Clear refresh token from database and get the role so that we can clear the correct cookies
        const result = await pool.query('UPDATE users SET refresh_token = NULL WHERE refresh_token = $1 RETURNING role', [refreshToken]);
        const userRole = result.rows[0]?.role;

        res.clearCookie(`${userRole}RefreshToken`, COOKIE_OPTIONS);
        res.clearCookie(`${userRole}AccessToken`, COOKIE_OPTIONS);

        return res.status(200).json({ message: 'Logout successful' });
    }
    catch (error) {
        console.error('Error logging out user:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

export const OTPSendingController = async (req: Request, res: Response): Promise<Response> => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    try {
        // Check if user exists
        const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Generate 6-digit OTP
        const plainOTP = Math.floor(100000 + Math.random() * 900000).toString();

        // Hash the OTP
        const hashedOTP = await bcrypt.hash(plainOTP, 10);

        // Set expiry to 10 minutes from now
        const expiryTime = new Date(Date.now() + 10 * 60 * 1000);

        // Save hashed OTP and expiry to database
        await pool.query(
            'UPDATE users SET OTP = $1, OTP_Expiry = $2 WHERE email = $3',
            [hashedOTP, expiryTime, email]
        );

        // Log plain OTP to console (for testing before email integration)
        console.log(`OTP for ${email}: ${plainOTP}`);

        return res.status(200).json({
            message: 'OTP sent successfully',
            email: email,
            expiresAt: expiryTime.toISOString()
        });
    } catch (e) {
        console.error("Error while generating and sending otp: ", e);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

export const OTPVerificationController = async (req: Request, res: Response): Promise<Response> => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ message: 'Email and OTP are required' });
    }

    try {
        // Get user with OTP and expiry
        const userResult = await pool.query(
            'SELECT id, OTP, OTP_Expiry FROM users WHERE email = $1',
            [email]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const user = userResult.rows[0];
        const storedHashedOTP = user.otp;
        const otpExpiry = user.otp_expiry;

        // Check if OTP exists
        if (!storedHashedOTP || !otpExpiry) {
            return res.status(400).json({ message: 'No OTP found. Please request a new OTP.' });
        }

        // Check if OTP has expired
        if (new Date() > new Date(otpExpiry)) {
            // Clear expired OTP
            await pool.query(
                'UPDATE users SET OTP = NULL, OTP_Expiry = NULL WHERE email = $1',
                [email]
            );
            return res.status(400).json({ message: 'OTP has expired. Please request a new OTP.' });
        }

        // Compare input OTP with stored hashed OTP
        const isOTPValid = await bcrypt.compare(otp, storedHashedOTP);

        if (!isOTPValid) {
            return res.status(401).json({ message: 'Invalid OTP' });
        }

        // Clear OTP fields after successful verification
        await pool.query(
            'UPDATE users SET OTP = NULL, OTP_Expiry = NULL WHERE email = $1',
            [email]
        );

        console.log(`OTP verified successfully for ${email}`);

        return res.status(200).json({
            message: 'OTP verified successfully',
            email: email,
            verified: true
        });
    } catch (e) {
        console.error("Error while verifying otp: ", e);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

export const verifyRegisteredUser = async (req: Request, res: Response): Promise<Response> => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ message: 'Email and OTP are required' });
    }

    try {
        // Get user with OTP, expiry, and verification status
        const userResult = await pool.query(
            'SELECT id, name, email, role, OTP, OTP_Expiry, is_verified FROM users WHERE email = $1',
            [email]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const user = userResult.rows[0];

        if (user.is_verified) {
            return res.status(400).json({ message: 'User is already verified. Please log in.' });
        }

        const storedHashedOTP = user.otp;
        const otpExpiry = user.otp_expiry;

        // Check if OTP exists
        if (!storedHashedOTP || !otpExpiry) {
            return res.status(400).json({ message: 'No OTP found. Please request a new OTP.' });
        }

        // Check if OTP has expired
        if (new Date() > new Date(otpExpiry)) {
            await pool.query(
                'UPDATE users SET OTP = NULL, OTP_Expiry = NULL WHERE email = $1',
                [email]
            );
            return res.status(400).json({ message: 'OTP has expired. Please request a new OTP.' });
        }

        // Compare input OTP with stored hashed OTP
        const isOTPValid = await bcrypt.compare(otp, storedHashedOTP);

        if (!isOTPValid) {
            return res.status(401).json({ message: 'Invalid OTP' });
        }

        // Mark user as verified and clear OTP fields
        await pool.query(
            'UPDATE users SET is_verified = TRUE, OTP = NULL, OTP_Expiry = NULL WHERE id = $1',
            [user.id]
        );

        // Generate access and refresh tokens
        const refreshToken = generateRefreshToken(user.id, user.name, user.email, user.role);
        const accessToken = generateAccessToken(user.id, user.name, user.email, user.role);

        // Store refresh token in database
        const tokenResult = await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2 RETURNING role', [refreshToken, user.id]);
        const userRole = tokenResult.rows[0]?.role;

        // Set cookies
        res.cookie(`${userRole}RefreshToken`, refreshToken, {
            ...COOKIE_OPTIONS,
            maxAge: 45 * 24 * 60 * 60 * 1000, // 45 days
        });

        res.cookie(`${userRole}AccessToken`, accessToken, {
            ...COOKIE_OPTIONS,
            maxAge: 30 * 60 * 1000, // 30 minutes
        });

        console.log(`User ${email} verified and logged in successfully`);

        return res.status(200).json({
            message: 'Email verified successfully. Registration complete.',
            user: { userId: user.id, username: user.name, email: user.email, role: user.role }
        });
    } catch (e) {
        console.error("Error while verifying registered user: ", e);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

export const resetPasswordController = async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
    }

    try {
        // Hash the new password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Update user password
        const result = await pool.query(
            'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id, email',
            [hashedPassword, email]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        return res.status(200).json({
            message: 'Password reset successfully',
            email: email
        });
    } catch (e) {
        console.error("Error while resetting password: ", e);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}

export const updateUserNameController = async (req: Request, res: Response): Promise<Response> => {
    const user = (req as any).user;
    if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { name } = req.body;
    if (!name || typeof name !== "string" || name.trim() === "") {
        return res.status(400).json({ message: "Name is required" });
    }

    try {
        const result = await pool.query(
            "UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, role",
            [name.trim(), user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const updatedUser = result.rows[0];
        return res.status(200).json({
            message: "User name updated successfully",
            user: { userId: updatedUser.id, username: updatedUser.name, email: updatedUser.email, role: updatedUser.role }
        });
    } catch (e) {
        console.error("Error updating user name:", e);
        return res.status(500).json({ message: "Internal Server Error" });
    }
}