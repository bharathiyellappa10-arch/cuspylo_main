-- CUSPYLO Module 04: Quiz question bank
-- Run once in the Neon SQL Editor. Additive migration; does not alter existing products/orders/users.

CREATE TABLE IF NOT EXISTS quiz_questions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question TEXT NOT NULL,
  option_a VARCHAR(1000) NOT NULL,
  option_b VARCHAR(1000) NOT NULL,
  option_c VARCHAR(1000) NOT NULL,
  option_d VARCHAR(1000) NOT NULL,
  correct_option CHAR(1) NOT NULL CHECK (correct_option IN ('A','B','C','D')),
  explanation TEXT NOT NULL DEFAULT '',
  academic_year VARCHAR(30) NOT NULL,
  subject VARCHAR(100) NOT NULL,
  published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_year_subject_published
  ON quiz_questions(academic_year, subject, published, created_at DESC);
