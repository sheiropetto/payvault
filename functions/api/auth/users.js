import { authenticate } from '../../utils/auth';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // All operations require admin role
  const user = await authenticate(request, env, 'write');
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

  try {
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT email, role, added_by, created_at FROM authorized_users ORDER BY created_at ASC'
      ).all();
      return Response.json(results);
    }

    if (request.method === 'POST') {
      const { email, role } = await request.json();
      if (!email?.trim()) return Response.json({ error: 'Email required' }, { status: 400 });
      if (!['admin', 'editor', 'viewer'].includes(role)) {
        return Response.json({ error: 'Invalid role' }, { status: 400 });
      }

      const { results } = await env.DB.prepare(
        'INSERT OR REPLACE INTO authorized_users (email, role, added_by) VALUES (?, ?, ?) RETURNING *'
      ).bind(email.toLowerCase().trim(), role, user.email).all();

      return Response.json(results[0], { status: 201 });
    }

    if (request.method === 'DELETE') {
      const email = url.searchParams.get('email');
      if (!email) return Response.json({ error: 'Email required' }, { status: 400 });

      // Prevent self-deletion
      if (email.toLowerCase() === user.email.toLowerCase()) {
        return Response.json({ error: 'Cannot remove yourself' }, { status: 400 });
      }

      await env.DB.prepare('DELETE FROM authorized_users WHERE email = ?')
        .bind(email.toLowerCase()).run();
      return new Response(null, { status: 204 });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
