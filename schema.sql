-- SETUP INSTRUCTIONS:
-- 1. Create a new database (in psql): CREATE DATABASE vitthal_db;
-- 2. Connect to it: \c vitthal_db;
-- 3. Then run this entire script.

-- This schema is designed to be idempotent where PostgreSQL supports it.

-- ============================================
-- B2B Multi-Vendor Marketplace - PostgreSQL Schema
-- ============================================

-- ================================
-- EXTENSIONS
-- ================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- PostGIS is optional. This schema stores latitude/longitude as numeric columns,
-- so it works on plain PostgreSQL without PostGIS installed.

-- ================================
-- TYPES
-- ================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('client', 'vendor', 'admin', 'super_admin');
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vendor_product_status') THEN
        CREATE TYPE vendor_product_status AS ENUM ('active', 'inactive', 'out_of_stock', 'discontinued', 'waiting');
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vendor_approval_status') THEN
        CREATE TYPE vendor_approval_status AS ENUM ('pending', 'agreement_sent', 'approved', 'rejected');
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
        CREATE TYPE order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'handed_over', 'received', 'dispatched');
    END IF;
END$$;

-- ================================
-- AUTHENTICATION LAYER
-- ================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email CITEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'client',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    OTP TEXT,
    refresh_token TEXT,
    OTP_Expiry TIMESTAMPTZ,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================
-- BUSINESS LAYER
-- ================================

CREATE TABLE IF NOT EXISTS vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    company_name TEXT NOT NULL,
    gst_number TEXT UNIQUE,
    gst_certificate_link TEXT,
    business_type TEXT,
    company_website TEXT,
    phone TEXT,
    alternative_number TEXT,
    designation TEXT,
    business_description TEXT,
    credit_cycle TEXT,
    minimum_commision_percentage INTEGER DEFAULT 0,
    maximum_commision_percentage INTEGER DEFAULT 0,
    rating NUMERIC(2,1) NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
    review_count INTEGER NOT NULL DEFAULT 0,
    is_approved BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    approval_status vendor_approval_status NOT NULL DEFAULT 'pending',
    approval_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_vendors_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_category (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================
-- SEED: default product categories (idempotent)
-- These inserts are guarded by WHERE NOT EXISTS so running the script
-- multiple times will not create duplicates.
-- ================================
INSERT INTO product_category (code, label, description, sort_order, is_active, created_at, updated_at)
SELECT 'plastic', 'Plastic', 'Polymers, granules, and molded plastic goods', 1, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM product_category WHERE code = 'plastic');

INSERT INTO product_category (code, label, description, sort_order, is_active, created_at, updated_at)
SELECT 'metal', 'Metal', 'Steel, aluminium, copper, and alloy products', 2, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM product_category WHERE code = 'metal');

INSERT INTO product_category (code, label, description, sort_order, is_active, created_at, updated_at)
SELECT 'chemicals', 'Chemicals', 'Industrial chemicals, additives, and solvents', 3, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM product_category WHERE code = 'chemicals');

INSERT INTO product_category (code, label, description, sort_order, is_active, created_at, updated_at)
SELECT 'construction', 'Construction', 'Cement, tiles, bricks, and building materials', 4, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM product_category WHERE code = 'construction');

INSERT INTO product_category (code, label, description, sort_order, is_active, created_at, updated_at)
SELECT 'machinery', 'Machinery', 'Industrial equipment, tools, and machine parts', 5, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM product_category WHERE code = 'machinery');

INSERT INTO product_category (code, label, description, sort_order, is_active, created_at, updated_at)
SELECT 'packaging', 'Packaging', 'Boxes, containers, films, and packing supplies', 6, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM product_category WHERE code = 'packaging');

INSERT INTO product_category (code, label, description, sort_order, is_active, created_at, updated_at)
SELECT 'textiles', 'Textiles', 'Fabrics, yarns, and textile supplies', 7, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM product_category WHERE code = 'textiles');

INSERT INTO product_category (code, label, description, sort_order, is_active, created_at, updated_at)
SELECT 'automotive', 'Automotive', 'Vehicle parts and transport components', 8, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM product_category WHERE code = 'automotive');

INSERT INTO product_category (code, label, description, sort_order, is_active, created_at, updated_at)
SELECT 'agriculture', 'Agriculture', 'Seeds, fertilizers, and farm inputs', 9, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM product_category WHERE code = 'agriculture');

INSERT INTO product_category (code, label, description, sort_order, is_active, created_at, updated_at)
SELECT 'electrical', 'Electrical', 'Cables, switches, wiring, and fittings', 10, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM product_category WHERE code = 'electrical');

CREATE TABLE IF NOT EXISTS vendor_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL,
    category_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_vendor_category_selection UNIQUE (vendor_id, category_id),
    CONSTRAINT fk_vendor_categories_vendor
        FOREIGN KEY (vendor_id)
        REFERENCES vendors(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_vendor_categories_category
        FOREIGN KEY (category_id)
        REFERENCES product_category(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vendor_categories_vendor_id ON vendor_categories(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_categories_category_id ON vendor_categories(category_id);

CREATE OR REPLACE FUNCTION enforce_vendor_category_limit()
RETURNS TRIGGER AS $$
DECLARE
    category_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO category_count
    FROM vendor_categories
    WHERE vendor_id = NEW.vendor_id;

    IF category_count >= 3 THEN
        RAISE EXCEPTION 'A vendor can select up to 3 categories only';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vendor_category_limit ON vendor_categories;
CREATE TRIGGER trg_vendor_category_limit
BEFORE INSERT ON vendor_categories
FOR EACH ROW
EXECUTE FUNCTION enforce_vendor_category_limit();

-- ================================
-- CATALOG LAYER
-- ================================

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    product_type TEXT,
    material TEXT,
    grade TEXT,
    application TEXT,
    standard TEXT,
    approval_status TEXT NOT NULL DEFAULT 'approved',
    approval_notes TEXT,
    created_by_user_id UUID,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    rating NUMERIC(2,1) NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
    review_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_products_product_type
        CHECK (product_type IS NULL OR product_type IN ('plastic', 'metal'))
);

CREATE TABLE IF NOT EXISTS products_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL,
    image_url TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_products_images_status
        CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT fk_products_images_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_products_images_created_by
        FOREIGN KEY (created_by_user_id)
        REFERENCES users(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_products_images_reviewed_by
        FOREIGN KEY (reviewed_by_user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
);

-- ================================
-- TRANSACTION LOGIC LAYER
-- ================================

CREATE TABLE IF NOT EXISTS vendor_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL,
    vendor_id UUID NOT NULL,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    moq INTEGER NOT NULL CHECK (moq > 0),
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    commision_percentage INTEGER DEFAULT 0 CHECK (commision_percentage >= 0 AND commision_percentage <= 100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    status vendor_product_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_vendor_product UNIQUE (vendor_id, product_id),
    CONSTRAINT fk_vendor_products_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_vendor_products_vendor
        FOREIGN KEY (vendor_id)
        REFERENCES vendors(id)
        ON DELETE CASCADE
);

CREATE TABLE product_specification(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    product_id UUID NOT NULL,

    spec_key TEXT NOT NULL,
    spec_value TEXT,
    approval_status TEXT NOT NULL DEFAULT 'pending',
    approval_notes TEXT,

    created_by_user_id UUID NOT NULL, -- user_id (admin/vendor)
    reviewed_by_user_id UUID,
    reviewed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_product_specification_status
        CHECK (approval_status IN ('pending', 'approved', 'rejected')),

    CONSTRAINT fk_product_specifications_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_product_specifications_created_by
        FOREIGN KEY (created_by_user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_product_specifications_reviewed_by
        FOREIGN KEY (reviewed_by_user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_product_specification_product_id ON product_specification(product_id);
CREATE INDEX IF NOT EXISTS idx_product_specification_status ON product_specification(approval_status);

CREATE TABLE addresses(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    country TEXT NOT NULL,
    pincode VARCHAR(6) NOT NULL CHECK (pincode ~ '^[0-9]{6}$'),
    latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_addresses_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE client(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_client_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE wishlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_wishlists_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE wishlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wishlist_id UUID NOT NULL,
    product_id UUID NOT NULL,
    vendor_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_wishlist_product UNIQUE (wishlist_id, product_id),
    CONSTRAINT fk_wishlist_items_wishlist
        FOREIGN KEY (wishlist_id)
        REFERENCES wishlists(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_wishlist_items_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_wishlist_items_vendor
        FOREIGN KEY (vendor_id)
        REFERENCES vendors(id)
        ON DELETE SET NULL
);

    CREATE TABLE abandoned_reminder_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('cart', 'wishlist')),
        source_item_id UUID NOT NULL,
        reminder_type TEXT NOT NULL DEFAULT '24h_abandoned_reminder',
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT unique_abandoned_reminder_source UNIQUE (source_type, source_item_id, reminder_type),
        CONSTRAINT fk_abandoned_reminder_logs_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    );

CREATE TABLE fulfillment_centers(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    country TEXT NOT NULL,
    pincode VARCHAR(6) NOT NULL CHECK (pincode ~ '^[0-9]{6}$'),
    latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
    capacity TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_fulfillment_centers_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

-- ================================
-- CART SYSTEM
-- ================================

--cart : 
CREATE TABLE carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL UNIQUE, -- ensures 1 cart per user (for now)

    status TEXT NOT NULL DEFAULT 'active', 
    -- future: active, converted, abandoned, saved

    total_amount NUMERIC(12,2) DEFAULT 0, -- optional (can be computed)

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_carts_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

--cart_items : 
CREATE TABLE cart_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    cart_id UUID NOT NULL,
    product_id UUID NOT NULL,
    vendor_id UUID NOT NULL,

    quantity INTEGER NOT NULL CHECK (quantity > 0),

    price_at_added NUMERIC(12,2) NOT NULL, -- snapshot price

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_cart_items_cart
        FOREIGN KEY (cart_id)
        REFERENCES carts(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_cart_items_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_cart_items_vendor
        FOREIGN KEY (vendor_id)
        REFERENCES vendors(id)
        ON DELETE CASCADE,

    CONSTRAINT unique_cart_product_vendor
        UNIQUE (cart_id, product_id, vendor_id)
);

-- ================================
-- ORDERS
-- ================================
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL,
    vendor_id UUID NOT NULL,

    cart_id UUID, -- reference to original cart (optional but useful)

    status TEXT NOT NULL DEFAULT 'pending',
    -- pending, confirmed, shipped, delivered, cancelled

    payment_status TEXT DEFAULT 'pending',
    -- pending, paid, failed

    total_amount NUMERIC(12,2) NOT NULL,
    source TEXT NOT NULL DEFAULT 'client',
    order_reference TEXT,
    order_notes TEXT,
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    created_by_admin_id TEXT,

    -- for storing address(not storing address refrence but storing address directly, because if refrence is stored them deletion of address by user become impossible)
    address_line TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    country TEXT NOT NULL,
    pincode VARCHAR(6) NOT NULL,
    latitude TEXT NOT NULL,
    langitude TEXT NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_orders_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id),
    CONSTRAINT fk_orders_cart FOREIGN KEY (cart_id) REFERENCES carts(id)
);

-- cart_items : 
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL,

    product_id UUID NOT NULL,  -- keep FK (since we are not deleting products)
    vendor_id UUID NOT NULL,

    quantity INTEGER NOT NULL CHECK (quantity > 0),

    price NUMERIC(12,2) NOT NULL, -- 🔥 final locked price at checkout

    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_order_items_order 
        FOREIGN KEY (order_id) 
        REFERENCES orders(id) 
        ON DELETE CASCADE,

    CONSTRAINT fk_order_items_product 
        FOREIGN KEY (product_id) 
        REFERENCES products(id),

    CONSTRAINT fk_order_items_vendor 
        FOREIGN KEY (vendor_id) 
        REFERENCES vendors(id)
);

CREATE TABLE IF NOT EXISTS order_status_history(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL,

    status order_status NOT NULL,
    note TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_order_status_history_order 
        FOREIGN KEY (order_id) 
        REFERENCES orders(id)
        ON DELETE CASCADE
);

CREATE TABLE order_fulfillment_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    order_id UUID NOT NULL,

    fulfillment_center_id UUID,

    status order_status NOT NULL,
    -- received, processing, dispatched, arrived, handed_over

    note TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_oft_order
        FOREIGN KEY (order_id)
        REFERENCES orders(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_oft_center
        FOREIGN KEY (fulfillment_center_id)
        REFERENCES fulfillment_centers(id)
        ON DELETE SET NULL
);

-- ================================
-- REVIEWS
-- ================================
CREATE TABLE IF NOT EXISTS order_item_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL,
    order_item_id UUID NOT NULL UNIQUE,
    user_id UUID NOT NULL,
    product_id UUID NOT NULL,
    vendor_id UUID NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_title TEXT,
    review_text TEXT,
    is_verified_purchase BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_order_item_reviews_order
        FOREIGN KEY (order_id)
        REFERENCES orders(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_order_item_reviews_order_item
        FOREIGN KEY (order_item_id)
        REFERENCES order_items(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_order_item_reviews_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_order_item_reviews_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_order_item_reviews_vendor
        FOREIGN KEY (vendor_id)
        REFERENCES vendors(id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vendor_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL,
    user_id UUID NOT NULL,
    vendor_id UUID NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_title TEXT,
    review_text TEXT,
    is_verified_purchase BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_vendor_review_per_order UNIQUE (order_id, vendor_id),
    CONSTRAINT fk_vendor_reviews_order
        FOREIGN KEY (order_id)
        REFERENCES orders(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_vendor_reviews_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_vendor_reviews_vendor
        FOREIGN KEY (vendor_id)
        REFERENCES vendors(id)
        ON DELETE CASCADE
);

-- ================================
-- INDEXES
-- ================================

-- Optimizing Foreign Keys (Postgres does not index these automatically)
CREATE INDEX IF NOT EXISTS idx_vendor_products_product_id ON vendor_products(product_id);
CREATE INDEX IF NOT EXISTS idx_products_images_product_id ON products_images(product_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_centers_user_id ON fulfillment_centers(user_id);

-- Optimizing Common Filtering Columns
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_vendors_rating ON vendors(rating DESC) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_product_type ON products(product_type);
CREATE INDEX IF NOT EXISTS idx_vendor_products_status ON vendor_products(status);

--cart indexes
CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id ON cart_items(product_id);
CREATE INDEX IF NOT EXISTS idx_wishlists_user_id ON wishlists(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_wishlist_id ON wishlist_items(wishlist_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_product_id ON wishlist_items(product_id);
CREATE INDEX IF NOT EXISTS idx_abandoned_reminder_logs_user_id ON abandoned_reminder_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_abandoned_reminder_logs_source ON abandoned_reminder_logs(source_type, source_item_id);

--order indexs : 
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE INDEX IF NOT EXISTS idx_vendor_categories_vendor_id ON vendor_categories(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_categories_category_id ON vendor_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_order_item_reviews_order_id ON order_item_reviews(order_id);
CREATE INDEX IF NOT EXISTS idx_order_item_reviews_user_id ON order_item_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_order_item_reviews_product_id ON order_item_reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_order_item_reviews_vendor_id ON order_item_reviews(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_reviews_order_id ON vendor_reviews(order_id);
CREATE INDEX IF NOT EXISTS idx_vendor_reviews_user_id ON vendor_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_vendor_reviews_vendor_id ON vendor_reviews(vendor_id);