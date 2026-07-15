import { authenticate } from '../../utils/auth';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const companyId = url.searchParams.get('company_id');

  try {
    const user = await authenticate(request, env, request.method === 'GET' ? 'read' : 'write');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (request.method === 'GET') {
      let query = 'SELECT * FROM templates';
      const params = [];

      if (companyId) {
        // Show default templates + company-specific
        query += ' WHERE company_id IS NULL OR company_id = ?';
        params.push(companyId);
      } else {
        query += ' WHERE company_id IS NULL';
      }

      query += ' ORDER BY is_default DESC, name ASC';

      const { results } = await env.DB.prepare(query).bind(...params).all();
      return Response.json(results);
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const { results } = await env.DB.prepare(
        `INSERT INTO templates (company_id, name, description, layout_config, is_default)
         VALUES (?, ?, ?, ?, ?) RETURNING *`
      ).bind(
        body.company_id || null, body.name, body.description || null,
        JSON.stringify(body.layout_config || {}), body.is_default ? 1 : 0
      ).all();

      return Response.json(results[0], { status: 201 });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
