import { authenticate } from '../../utils/auth';

export async function onRequest(context) {
  const { request, env, params } = context;
  const { id } = params;

  try {
    const user = await authenticate(request, env, request.method === 'GET' ? 'read' : 'write');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (request.method === 'GET') {
      const company = await env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(id).first();
      if (!company) return new Response('Not found', { status: 404 });
      return Response.json(company);
    }

    if (request.method === 'PATCH') {
      const ALLOWED = ['name', 'logo_url', 'address', 'phone', 'email', 'tax_id', 'bank_name', 'bank_account', 'signature_name', 'signature_title', 'show_logo', 'show_address', 'show_phone', 'show_email', 'show_tax_id', 'show_bank_details', 'show_signature'];
      const body = await request.json();
      const fields = Object.keys(body).filter(k => ALLOWED.includes(k));
      if (!fields.length) return Response.json({ error: 'No valid fields' }, { status: 400 });
      const setClauses = fields.map(f => `${f} = ?`).join(', ');
      const values = fields.map(f => body[f]);

      const { results } = await env.DB.prepare(
        `UPDATE companies SET ${setClauses}, updated_at = datetime('now') WHERE id = ? RETURNING *`
      ).bind(...values, id).all();

      if (!results.length) return new Response('Not found', { status: 404 });
      return Response.json(results[0]);
    }

    if (request.method === 'DELETE') {
      const result = await env.DB.prepare('DELETE FROM companies WHERE id = ?').bind(id).run();
      if (!result.meta.changes) return new Response('Not found', { status: 404 });
      return new Response(null, { status: 204 });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
