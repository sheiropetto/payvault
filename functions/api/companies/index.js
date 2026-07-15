import { authenticate } from '../../utils/auth';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    // Auth: read for GET, write for POST
    const user = await authenticate(request, env, request.method === 'GET' ? 'read' : 'write');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM companies ORDER BY name ASC'
      ).all();
      return Response.json(results);
    }

    if (request.method === 'POST') {
      const body = await request.json();

      // Validate required fields
      if (!body.name?.trim()) return Response.json({ error: 'Company name is required' }, { status: 400 });
      const { results } = await env.DB.prepare(
        `INSERT INTO companies (name, logo_url, address, phone, email, tax_id, bank_name, bank_account,
          signature_name, signature_title, show_logo, show_address, show_phone, show_email,
          show_tax_id, show_bank_details, show_signature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`
      ).bind(
        body.name, body.logo_url || null, body.address || null, body.phone || null,
        body.email || null, body.tax_id || null, body.bank_name || null, body.bank_account || null,
        body.signature_name || null, body.signature_title || null,
        body.show_logo ?? 1, body.show_address ?? 1, body.show_phone ?? 0, body.show_email ?? 0,
        body.show_tax_id ?? 1, body.show_bank_details ?? 1, body.show_signature ?? 1
      ).all();
      return Response.json(results[0], { status: 201 });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
