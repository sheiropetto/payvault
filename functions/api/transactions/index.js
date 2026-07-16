import { authenticate } from '../../utils/auth';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const statementId = url.searchParams.get('statement_id');

  try {
    const user = await authenticate(request, env, request.method === 'GET' ? 'read' : 'write');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (request.method === 'GET') {
      let query = `SELECT t.*,
                          vt.voucher_id,
                          pv.voucher_number,
                          pv.status as voucher_status
                   FROM transactions t
                   LEFT JOIN voucher_transactions vt ON vt.transaction_id = t.id
                   LEFT JOIN payment_vouchers pv ON pv.id = vt.voucher_id`;
      const params = [];

      if (statementId) {
        query += ' WHERE t.bank_statement_id = ?';
        params.push(statementId);
      }

      query += ' ORDER BY t.date ASC, t.rowid ASC';

      const { results } = await env.DB.prepare(query).bind(...params).all();
      return Response.json(results);
    }

    if (request.method === 'PATCH') {
      // Bulk update transactions (from editable sheet)
      const { updates } = await request.json();
      if (!Array.isArray(updates)) {
        return Response.json({ error: 'updates array required' }, { status: 400 });
      }

      const ALLOWED = ['date', 'description', 'payee', 'category', 'debit_amount', 'credit_amount', 'notes', 'particulars'];
      const results = [];
      for (const update of updates) {
        const { id, ...rawFields } = update;
        const fields = Object.fromEntries(
          Object.entries(rawFields).filter(([k]) => ALLOWED.includes(k))
        );
        if (!Object.keys(fields).length) continue;
        const setClauses = Object.keys(fields).map(f => `${f} = ?`).join(', ');
        const values = Object.keys(fields).map(f => fields[f]);

        const { results: updated } = await env.DB.prepare(
          `UPDATE transactions SET ${setClauses}, is_edited = 1 WHERE id = ? RETURNING *`
        ).bind(...values, id).all();

        if (updated.length) results.push(updated[0]);
      }

      return Response.json(results);
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
