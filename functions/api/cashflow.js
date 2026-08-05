import { authenticate } from '../utils/auth';

// Cash-flow aggregation for a company (optionally a single year).
// Serves both the "Money In" and "Money Out" pages:
//   GET /api/cashflow?company_id=XXX[&year=YYYY]
// Returns:
//   summary      — total debit/credit + counts
//   by_month     — per-month debit/credit (when a year is given; 12 months)
//   by_year      — per-year debit/credit (when NO year is given)
//   by_payee     — per-payee debit/credit (ALL payees, ranked by combined value)
//   by_category  — per-category debit/credit + tx count
//   transactions — the drill-down rows for the selected scope
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const companyId = url.searchParams.get('company_id');
  const year = url.searchParams.get('year');

  try {
    const user = await authenticate(request, env, 'read');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    if (!companyId) {
      return Response.json({ error: 'company_id required' }, { status: 400 });
    }

    const yearValid = year && /^\d{4}$/.test(year) ? year : null;
    const params = [companyId];
    let yearClause = '';
    if (yearValid) {
      yearClause = ' AND substr(t.date, 1, 4) = ?';
      params.push(yearValid);
    }

    // ── Summary ──
    const summary = await env.DB.prepare(`
      SELECT
        COUNT(*) as total_tx,
        COALESCE(SUM(CASE WHEN t.debit_amount > 0 THEN 1 ELSE 0 END), 0) as dr_count,
        COALESCE(SUM(CASE WHEN t.credit_amount > 0 THEN 1 ELSE 0 END), 0) as cr_count,
        COALESCE(ROUND(SUM(t.debit_amount), 2), 0) as total_debit,
        COALESCE(ROUND(SUM(t.credit_amount), 2), 0) as total_credit
      FROM transactions t
      JOIN bank_statements bs ON bs.id = t.bank_statement_id
      WHERE bs.company_id = ?${yearClause}
    `).bind(...params).first();

    // ── Monthly (specific year) or yearly (all years) ──
    let by_month = [];
    let by_year = [];
    if (yearValid) {
      const { results: m } = await env.DB.prepare(`
        SELECT CAST(substr(t.date, 6, 2) AS INTEGER) as month,
          COALESCE(ROUND(SUM(t.debit_amount), 2), 0) as debit,
          COALESCE(ROUND(SUM(t.credit_amount), 2), 0) as credit
        FROM transactions t
        JOIN bank_statements bs ON bs.id = t.bank_statement_id
        WHERE bs.company_id = ? AND substr(t.date, 1, 4) = ?
        GROUP BY month ORDER BY month
      `).bind(companyId, yearValid).all();
      by_month = m;
    } else {
      const { results: y } = await env.DB.prepare(`
        SELECT CAST(substr(t.date, 1, 4) AS INTEGER) as year,
          COALESCE(ROUND(SUM(t.debit_amount), 2), 0) as debit,
          COALESCE(ROUND(SUM(t.credit_amount), 2), 0) as credit
        FROM transactions t
        JOIN bank_statements bs ON bs.id = t.bank_statement_id
        WHERE bs.company_id = ?
        GROUP BY year ORDER BY year
      `).bind(companyId).all();
      by_year = y;
    }

    // ── By payee (all, ranked) ──
    const { results: by_payee } = await env.DB.prepare(`
      SELECT t.payee,
        COALESCE(ROUND(SUM(t.debit_amount), 2), 0) as debit,
        COALESCE(ROUND(SUM(t.credit_amount), 2), 0) as credit
      FROM transactions t
      JOIN bank_statements bs ON bs.id = t.bank_statement_id
      WHERE bs.company_id = ?${yearClause} AND t.payee IS NOT NULL AND t.payee != ''
      GROUP BY t.payee
      ORDER BY (SUM(t.debit_amount) + SUM(t.credit_amount)) DESC
    `).bind(...params).all();

    // ── By category ──
    const { results: by_category } = await env.DB.prepare(`
      SELECT COALESCE(t.category, 'Other') as category,
        COUNT(*) as tx_count,
        COALESCE(ROUND(SUM(t.debit_amount), 2), 0) as debit,
        COALESCE(ROUND(SUM(t.credit_amount), 2), 0) as credit
      FROM transactions t
      JOIN bank_statements bs ON bs.id = t.bank_statement_id
      WHERE bs.company_id = ?${yearClause}
      GROUP BY t.category
      ORDER BY (SUM(t.debit_amount) + SUM(t.credit_amount)) DESC
    `).bind(...params).all();

    // ── Drill-down rows ──
    const { results: transactions } = await env.DB.prepare(`
      SELECT t.id, t.date, t.description, t.payee, t.category, t.particulars,
        t.debit_amount, t.credit_amount, bs.filename as statement
      FROM transactions t
      JOIN bank_statements bs ON bs.id = t.bank_statement_id
      WHERE bs.company_id = ?${yearClause}
      ORDER BY t.date DESC, t.rowid DESC
    `).bind(...params).all();

    return Response.json({
      summary: summary || { total_tx: 0, dr_count: 0, cr_count: 0, total_debit: 0, total_credit: 0 },
      by_month: by_month || [],
      by_year: by_year || [],
      by_payee: by_payee || [],
      by_category: by_category || [],
      transactions: transactions || [],
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
