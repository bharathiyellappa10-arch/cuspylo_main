-- CUSPYLO Module 07: Razorpay checkout and coupon support.
-- Additive only: preserves existing orders and order items. Run once in Neon SQL Editor.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(60),
  ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS razorpay_signature VARCHAR(256);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_razorpay_order_id
  ON orders(razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_payment_status_created
  ON orders(payment_status, created_at DESC);
