import pool from "./DbConnect";

export async function ensureMarketplaceSchema() {
    await pool.query(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
        CREATE EXTENSION IF NOT EXISTS citext;

        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
                CREATE TYPE user_role AS ENUM ('client', 'vendor', 'admin', 'super_admin');
            END IF;
        END $$;

        CREATE TABLE IF NOT EXISTS products_images (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            product_id UUID NOT NULL,
            image_url TEXT NOT NULL,
            is_primary BOOLEAN NOT NULL DEFAULT FALSE,
            display_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS vendor_products (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            product_id UUID NOT NULL,
            vendor_id UUID NOT NULL,
            price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
            moq INTEGER NOT NULL CHECK (moq > 0),
            stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
            commision_percentage INTEGER DEFAULT 0 CHECK (commision_percentage >= 0 AND commision_percentage <= 100),
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT unique_vendor_product UNIQUE (vendor_id, product_id)
        );

        CREATE TABLE IF NOT EXISTS addresses (
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
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS client (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL UNIQUE,
            phone TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE products
            ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
            ADD COLUMN IF NOT EXISTS approval_notes TEXT,
            ADD COLUMN IF NOT EXISTS created_by_user_id UUID,
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

        ALTER TABLE vendors
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending',
            ADD COLUMN IF NOT EXISTS approval_notes TEXT,
            ADD COLUMN IF NOT EXISTS gst_certificate_link TEXT,
            ADD COLUMN IF NOT EXISTS business_type TEXT,
            ADD COLUMN IF NOT EXISTS company_website TEXT,
            ADD COLUMN IF NOT EXISTS alternative_number TEXT,
            ADD COLUMN IF NOT EXISTS designation TEXT,
            ADD COLUMN IF NOT EXISTS business_description TEXT,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

        ALTER TABLE orders
            ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'client',
            ADD COLUMN IF NOT EXISTS order_reference TEXT,
            ADD COLUMN IF NOT EXISTS order_notes TEXT,
            ADD COLUMN IF NOT EXISTS customer_name TEXT,
            ADD COLUMN IF NOT EXISTS customer_email TEXT,
            ADD COLUMN IF NOT EXISTS customer_phone TEXT,
            ADD COLUMN IF NOT EXISTS created_by_admin_id TEXT,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

        ALTER TABLE products_images
            ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

        ALTER TABLE vendor_products
            ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS commision_percentage INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

        ALTER TABLE addresses
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

        ALTER TABLE client
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_products_images_product'
                  AND table_name = 'products_images'
            ) THEN
                ALTER TABLE products_images
                    ADD CONSTRAINT fk_products_images_product
                    FOREIGN KEY (product_id)
                    REFERENCES products(id)
                    ON DELETE CASCADE;
            END IF;

            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_vendor_products_product'
                  AND table_name = 'vendor_products'
            ) THEN
                ALTER TABLE vendor_products
                    ADD CONSTRAINT fk_vendor_products_product
                    FOREIGN KEY (product_id)
                    REFERENCES products(id)
                    ON DELETE CASCADE;
            END IF;

            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_vendor_products_vendor'
                  AND table_name = 'vendor_products'
            ) THEN
                ALTER TABLE vendor_products
                    ADD CONSTRAINT fk_vendor_products_vendor
                    FOREIGN KEY (vendor_id)
                    REFERENCES vendors(id)
                    ON DELETE CASCADE;
            END IF;

            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_addresses_user'
                  AND table_name = 'addresses'
            ) THEN
                ALTER TABLE addresses
                    ADD CONSTRAINT fk_addresses_user
                    FOREIGN KEY (user_id)
                    REFERENCES users(id)
                    ON DELETE CASCADE;
            END IF;

            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_client_user'
                  AND table_name = 'client'
            ) THEN
                ALTER TABLE client
                    ADD CONSTRAINT fk_client_user
                    FOREIGN KEY (user_id)
                    REFERENCES users(id)
                    ON DELETE CASCADE;
            END IF;
        END $$;

        CREATE INDEX IF NOT EXISTS idx_vendor_products_product_id ON vendor_products(product_id);
        CREATE INDEX IF NOT EXISTS idx_products_images_product_id ON products_images(product_id);
        CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
        CREATE INDEX IF NOT EXISTS idx_products_product_type ON products(product_type);
        CREATE INDEX IF NOT EXISTS idx_vendors_rating ON vendors(rating DESC) WHERE is_active = TRUE;

        UPDATE products
        SET approval_status = 'approved'
        WHERE approval_status IS NULL OR approval_status::TEXT = '';

        UPDATE vendors
        SET approval_status = 'approved'
        WHERE approval_status IS NULL OR approval_status::TEXT = '';

        UPDATE orders
        SET source = 'client'
        WHERE source IS NULL OR source::TEXT = '';
    `);
}
