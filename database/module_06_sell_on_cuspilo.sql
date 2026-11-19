-- Module 06: Sell on Cuspilo marketplace. Additive migration; existing data is preserved.
ALTER TABLE admin_products ADD COLUMN IF NOT EXISTS seller_listing_id BIGINT;
CREATE TABLE IF NOT EXISTS seller_listings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_user_id BIGINT NOT NULL REFERENCES users(id),
  product_name VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  years_used NUMERIC(4,1) NOT NULL CHECK (years_used >= 0),
  academic_year VARCHAR(30) NOT NULL,
  subject VARCHAR(100) NOT NULL,
  asking_price NUMERIC(10,2) NOT NULL CHECK (asking_price > 0),
  image_data TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','SOLD')),
  admin_note TEXT NOT NULL DEFAULT '',
  approved_product_id BIGINT REFERENCES admin_products(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seller_listings_owner ON seller_listings(seller_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_listings_review ON seller_listings(status,created_at ASC);
CREATE TABLE IF NOT EXISTS seller_payouts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_listing_id BIGINT NOT NULL REFERENCES seller_listings(id),
  order_id BIGINT NOT NULL REFERENCES orders(id),
  seller_user_id BIGINT NOT NULL REFERENCES users(id),
  product_amount NUMERIC(10,2) NOT NULL,
  commission_amount NUMERIC(10,2) NOT NULL,
  seller_amount NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(seller_listing_id,order_id)
);
