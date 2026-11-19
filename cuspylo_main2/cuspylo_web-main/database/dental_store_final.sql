-- CUSPYLO Dental Store v2: additive migration. Run once in Neon SQL Editor.
-- Existing orders/products are preserved. Legacy TOOTH orders remain readable as historical records.
ALTER TABLE admin_products
  ADD COLUMN IF NOT EXISTS multi_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS store_group VARCHAR(40) NOT NULL DEFAULT 'DENTAL_STORE',
  ADD COLUMN IF NOT EXISTS search_keywords TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quality_note TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS academic_subjects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  academic_year VARCHAR(30) NOT NULL,
  subject_name VARCHAR(100) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (academic_year, subject_name)
);

INSERT INTO academic_subjects(academic_year,subject_name,sort_order) VALUES
('1st Year','DADH',1),('1st Year','Biochemistry',2),('1st Year','Physiology',3),('1st Year','General Anatomy',4),
('2nd Year','Pharmacology',1),('2nd Year','Dental Materials',2),('2nd Year','Microbiology',3),('2nd Year','General Pathology',4),
('3rd Year','Oral Pathology',1),('3rd Year','Periodontology',2),('3rd Year','Oral Medicine',3),
('4th Year','Prosthodontics',1),('4th Year','Endodontics',2),('4th Year','Orthodontics',3),('4th Year','Oral Surgery',4)
ON CONFLICT (academic_year,subject_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_kits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  kit_type VARCHAR(40) NOT NULL CHECK (kit_type IN ('CUSTOMIZABLE','PREMIUM','HIGH_PERFORMANCE','BALANCED','ECONOMY')),
  academic_year VARCHAR(30) NOT NULL DEFAULT 'Universal',
  subject VARCHAR(100) NOT NULL DEFAULT 'Universal',
  description TEXT NOT NULL DEFAULT '',
  quality_disclosure TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS admin_kit_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kit_id BIGINT NOT NULL REFERENCES admin_kits(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES admin_products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE(kit_id,product_id)
);
CREATE INDEX IF NOT EXISTS idx_admin_kits_discovery ON admin_kits(active,academic_year,subject,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_kit_items_kit ON admin_kit_items(kit_id);
CREATE INDEX IF NOT EXISTS idx_admin_products_store ON admin_products(active,product_type,academic_year,subject);
