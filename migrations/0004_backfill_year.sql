-- Backfill year from first transaction's date for existing statements
UPDATE bank_statements
SET year = CAST(substr(t.date, 1, 4) AS INTEGER),
    month = CAST(substr(t.date, 6, 2) AS INTEGER)
FROM (
  SELECT bank_statement_id, MIN(date) as date
  FROM transactions
  GROUP BY bank_statement_id
) t
WHERE bank_statements.id = t.bank_statement_id
  AND bank_statements.year IS NULL;
