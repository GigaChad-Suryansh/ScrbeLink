-- ScribeLink PostgreSQL Database Schema
-- Matches the specification: users, roles, auth OTPs, scribes, orders, checkins, escrow ledger, disputes

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Roles Enum
CREATE TYPE user_role AS ENUM ('customer', 'scribe', 'admin');

-- 2. Order Status Enum
CREATE TYPE order_status AS ENUM ('Paid', 'Accepted', 'Writing', 'Dispatched', 'Delivered', 'Disputed', 'Cancelled');

-- 3. Escrow Transaction Status
CREATE TYPE escrow_status AS ENUM ('held', 'released', 'refunded', 'disputed');

-- 4. Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(15) UNIQUE NOT NULL,
    role user_role NOT NULL DEFAULT 'customer',
    name VARCHAR(100),
    email VARCHAR(255),
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Phone OTP Sessions Table
CREATE TABLE auth_otps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(15) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INT DEFAULT 0,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_auth_otps_phone ON auth_otps(phone);

-- 6. Scribe Profiles Table
CREATE TABLE scribes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag VARCHAR(20) UNIQUE NOT NULL, -- e.g. 'S-2041'
    college VARCHAR(255) NOT NULL,
    upi_vpa VARCHAR(100) NOT NULL,
    handwriting_sample_url TEXT,
    sample_text TEXT,
    specialties TEXT[] DEFAULT '{}',
    rating NUMERIC(2, 1) DEFAULT 5.0,
    total_orders INT DEFAULT 0,
    strikes INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Orders Table
CREATE TABLE orders (
    id VARCHAR(30) PRIMARY KEY, -- e.g. 'SL-7412'
    customer_id UUID NOT NULL REFERENCES users(id),
    scribe_id UUID REFERENCES scribes(id),
    title VARCHAR(255) NOT NULL,
    subject VARCHAR(100) NOT NULL,
    status order_status NOT NULL DEFAULT 'Paid',
    word_count INT NOT NULL,
    billable_pages INT NOT NULL,
    pen_type VARCHAR(50) DEFAULT 'ballpoint',
    ink_color VARCHAR(30) DEFAULT 'blue',
    custom_template BOOLEAN DEFAULT FALSE,
    simple_drawings INT DEFAULT 0,
    complex_drawings INT DEFAULT 0,
    graphs INT DEFAULT 0,
    customer_total NUMERIC(10, 2) NOT NULL,
    scribe_payout NUMERIC(10, 2) NOT NULL,
    platform_cut NUMERIC(10, 2) NOT NULL,
    delivery_otp VARCHAR(6),
    intake_deadline TIMESTAMP WITH TIME ZONE,
    final_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_scribe ON orders(scribe_id);
CREATE INDEX idx_orders_status ON orders(status);

-- 8. Rush Check-ins Table
CREATE TABLE order_checkins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(30) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    scribe_id UUID NOT NULL REFERENCES scribes(id),
    note TEXT,
    snapshot_url TEXT,
    checkin_time TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_order_checkins_order ON order_checkins(order_id);

-- 9. Escrow Ledger Table
CREATE TABLE escrow_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(30) UNIQUE NOT NULL REFERENCES orders(id),
    amount NUMERIC(10, 2) NOT NULL,
    status escrow_status NOT NULL DEFAULT 'held',
    payer_upi VARCHAR(100),
    payout_upi VARCHAR(100),
    release_due_at TIMESTAMP WITH TIME ZONE,
    released_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Order Timeline Audit Log
CREATE TABLE order_audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(30) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    from_status order_status,
    to_status order_status NOT NULL,
    actor_id UUID REFERENCES users(id),
    note TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_audit_order ON order_audit_events(order_id);
