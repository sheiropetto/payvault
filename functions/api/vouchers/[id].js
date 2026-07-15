import { authenticate } from '../../utils/auth';

export async function onRequest(context) {
  const { request, env, params } = context;
  const { id } = params;

  try {
    const user = await authenticate(request, env, request.method === 'GET' ? 'read' : 'write');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (request.method === 'GET') {
      const voucher = await env.DB.prepare(
        `SELECT pv.*, c.name as company_name
         FROM payment_vouchers pv
         JOIN companies c ON c.id = pv.company_id
         WHERE pv.id = ?`
      ).bind(id).first();

      if (!voucher) return new Response('Not found', { status: 404 });

      // Get linked transactions
      const { results: transactions } = await env.DB.prepare(
        `SELECT t.* FROM transactions t
         JOIN voucher_transactions vt ON vt.transaction_id = t.id
         WHERE vt.voucher_id = ?`
      ).bind(id).all();

      return Response.json({ ...voucher, transactions });
    }

    if (request.method === 'PATCH') {
      const ALLOWED = ['payee', 'amount', 'date', 'description', 'invoice_ref', 'category', 'payment_method', 'status', 'notes', 'template_id'];
      const body = await request.json();
      const fields = Object.keys(body).filter(k => ALLOWED.includes(k));
      if (!fields.length) return Response.json({ error: 'No valid fields' }, { status: 400 });
      const setClauses = fields.map(f => `${f} = ?`).join(', ');
      const values = fields.map(f => body[f]);

      const { results } = await env.DB.prepare(
        `UPDATE payment_vouchers SET ${setClauses}, updated_at = datetime('now') WHERE id = ? RETURNING *`
      ).bind(...values, id).all();

      if (!results.length) return new Response('Not found', { status: 404 });
      return Response.json(results[0]);
    }

    if (request.method === 'DELETE') {
      // Unlink transactions
      const { results: linked } = await env.DB.prepare(
        'SELECT transaction_id FROM voucher_transactions WHERE voucher_id = ?'
      ).bind(id).all();

      for (const { transaction_id } of linked) {
        await env.DB.prepare(
          'UPDATE transactions SET is_vouchered = 0 WHERE id = ?'
        ).bind(transaction_id).run();
      }

      // Explicitly delete voucher_transactions first
      await env.DB.prepare('DELETE FROM voucher_transactions WHERE voucher_id = ?').bind(id).run();
      // Then delete the voucher
      await env.DB.prepare('DELETE FROM payment_vouchers WHERE id = ?').bind(id).run();
      return new Response(null, { status: 204 });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
