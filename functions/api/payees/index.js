import { authenticate } from '../../utils/auth';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const companyId = url.searchParams.get('company_id');

  try {
    const user = await authenticate(request, env, request.method === 'GET' ? 'read' : 'write');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (request.method === 'GET') {
      if (!companyId) {
        return Response.json({ error: 'company_id required' }, { status: 400 });
      }

      // Aggregate unique payees across all bank statements for this company
      const { results } = await env.DB.prepare(`
        SELECT
          t.payee,
          COUNT(*) as tx_count,
          COUNT(DISTINCT t.bank_statement_id) as stmt_count
        FROM transactions t
        JOIN bank_statements bs ON bs.id = t.bank_statement_id
        WHERE bs.company_id = ? AND t.payee IS NOT NULL AND t.payee != ''
        GROUP BY t.payee
        ORDER BY t.payee ASC
      `).bind(companyId).all();

      return Response.json(results);
    }

    if (request.method === 'PATCH') {
      const { oldPayee, newPayee } = await request.json();
      if (!oldPayee || !newPayee || oldPayee === newPayee) {
        return Response.json({ error: 'oldPayee and newPayee required and must differ' }, { status: 400 });
      }

      // Update all transactions with the old payee name to the new one
      const { meta } = await env.DB.prepare(
        `UPDATE transactions SET payee = ?, is_edited = 1 WHERE payee = ?`
      ).bind(newPayee, oldPayee).run();

      return Response.json({ updated: meta.changes, oldPayee, newPayee });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
