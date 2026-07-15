import { authenticate } from '../../utils/auth';

export async function onRequest(context) {
  const { request, env, params } = context;
  const { id } = params;

  try {
    const user = await authenticate(request, env, request.method === 'GET' ? 'read' : 'write');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (request.method === 'GET') {
      const template = await env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first();
      if (!template) return new Response('Not found', { status: 404 });
      return Response.json(template);
    }

    if (request.method === 'PATCH') {
      const body = await request.json();
      if (body.layout_config && typeof body.layout_config === 'object') {
        body.layout_config = JSON.stringify(body.layout_config);
      }
      const fields = Object.keys(body);
      const setClauses = fields.map(f => `${f} = ?`).join(', ');
      const values = fields.map(f => body[f]);

      const { results } = await env.DB.prepare(
        `UPDATE templates SET ${setClauses} WHERE id = ? RETURNING *`
      ).bind(...values, id).all();

      if (!results.length) return new Response('Not found', { status: 404 });
      return Response.json(results[0]);
    }

    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(id).run();
      return new Response(null, { status: 204 });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
