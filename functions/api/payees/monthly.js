import { authenticate } from '../../utils/auth';

// Monthly debit/credit totals per payee for a given company + year.
// Returns rows like { payee, month (1-12), total_debit, total_credit }.
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
    if (!year || !/^\d{4}$/.test(year)) {
      return Response.json({ error: 'year required (YYYY)' }, { status: 400 });
    }

    const { results } = await env.DB.prepare(`
      SELECT
        t.payee,
        CAST(substr(t.date, 6, 2) AS INTEGER) as month,
        SUM(CASE WHEN t.debit_amount > 0 THEN t.debit_amount ELSE 0 END) as total_debit,
        SUM(CASE WHEN t.credit_amount > 0 THEN t.credit_amount ELSE 0 END) as total_credit
      FROM transactions t
      JOIN bank_statements bs ON bs.id = t.bank_statement_id
      WHERE bs.company_id = ? AND t.payee IS NOT NULL AND t.payee != '' AND substr(t.date, 1, 4) = ?
      GROUP BY t.payee, substr(t.date, 1, 7)
      ORDER BY t.payee ASC, month ASC
    `).bind(companyId, year).all();

    return Response.json(results);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
