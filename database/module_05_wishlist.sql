-- CUSPYLO Wishlist Module 05
-- Additive migration. Stores saved items per student account.
CREATE TABLE IF NOT EXISTS student_wishlist (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('product','kit')),
  product_id BIGINT REFERENCES admin_products(id) ON DELETE CASCADE,
  kit_id BIGINT REFERENCES admin_kits(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_wishlist_item_shape CHECK (
    (item_type='product' AND product_id IS NOT NULL AND kit_id IS NULL) OR
    (item_type='kit' AND kit_id IS NOT NULL AND product_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_wishlist_product
  ON student_wishlist(user_id,product_id) WHERE item_type='product';
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_wishlist_kit
  ON student_wishlist(user_id,kit_id) WHERE item_type='kit';
CREATE INDEX IF NOT EXISTS idx_student_wishlist_user_created
  ON student_wishlist(user_id,created_at DESC);
