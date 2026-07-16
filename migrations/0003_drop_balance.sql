-- Drop balance column from transactions (no longer needed, inaccurate from AI extraction)
ALTER TABLE transactions DROP COLUMN balance;
