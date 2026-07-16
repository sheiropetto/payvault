import { authenticate } from '../../utils/auth';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const companyId = url.searchParams.get('company_id');

  try {
    const user = await authenticate(request, env, request.method === 'GET' ? 'read' : 'write');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (request.method === 'GET') {
      let query = `SELECT pv.*, c.name as company_name
                   FROM payment_vouchers pv
                   JOIN companies c ON c.id = pv.company_id`;
      const params = [];

      if (companyId) {
        query += ' WHERE pv.company_id = ?';
        params.push(companyId);
      }

      query += ' ORDER BY pv.created_at DESC';

      const { results } = await env.DB.prepare(query).bind(...params).all();
      return Response.json(results);
    }

    if (request.method === 'POST') {
      const body = await request.json();

      // Validate required fields
      if (!body.company_id) return Response.json({ error: 'company_id is required' }, { status: 400 });
      if (!body.amount || Number(body.amount) <= 0) return Response.json({ error: 'amount must be positive' }, { status: 400 });
      if (!body.date) return Response.json({ error: 'date is required' }, { status: 400 });

      // Generate voucher number
      const prefix = 'PV';
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const { results: count } = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM payment_vouchers WHERE voucher_number LIKE ?`
      ).bind(`${prefix}${dateStr}%`).all();

      const seq = String((count[0]?.cnt || 0) + 1).padStart(3, '0');
      const voucherNumber = `${prefix}${dateStr}${seq}`;

      const { results } = await env.DB.prepare(
        `INSERT INTO payment_vouchers
         (company_id, template_id, voucher_number, payee, amount, date, description,
          invoice_ref, category, payment_method, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`
      ).bind(
        body.company_id, body.template_id || null, voucherNumber,
        body.payee, body.amount, body.date, body.description || null,
        body.invoice_ref || null, body.category || null, body.payment_method || null,
        body.status || 'draft', body.notes || null, body.created_by || null
      ).all();

      // Link transactions if provided
      if (body.transaction_ids?.length) {
        const insert = env.DB.prepare(
          'INSERT OR IGNORE INTO voucher_transactions (voucher_id, transaction_id) VALUES (?, ?)'
        );
        for (const tid of body.transaction_ids) {
          await insert.bind(results[0].id, tid).run();
        }
        // Mark transactions as vouchered
        for (const tid of body.transaction_ids) {
          await env.DB.prepare(
            'UPDATE transactions SET is_vouchered = 1 WHERE id = ?'
          ).bind(tid).run();
        }
      }

      return Response.json(results[0], { status: 201 });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
