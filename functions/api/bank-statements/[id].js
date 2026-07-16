import { authenticate } from '../../utils/auth';

export async function onRequest(context) {
  const { request, env, params } = context;
  const { id } = params;
  const url = new URL(request.url);

  try {
    const user = await authenticate(request, env, request.method === 'DELETE' ? 'write' : 'read');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (request.method === 'GET') {
      // If requesting file download
      if (url.searchParams.get('download') === 'true') {
        const stmt = await env.DB.prepare(
          'SELECT * FROM bank_statements WHERE id = ?'
        ).bind(id).first();
        if (!stmt) return new Response('Not found', { status: 404 });

        const fileObj = await env.STORAGE.get(stmt.file_url);
        if (!fileObj) return new Response('File not found', { status: 404 });

        const headers = new Headers();
        headers.set('Content-Type', 'application/pdf');
        headers.set('Content-Disposition', `attachment; filename="${stmt.filename}"`);

        return new Response(fileObj.body, { headers });
      }

      const stmt = await env.DB.prepare(
        `SELECT bs.*, c.name as company_name
         FROM bank_statements bs
         JOIN companies c ON c.id = bs.company_id
         WHERE bs.id = ?`
      ).bind(id).first();

      if (!stmt) return new Response('Not found', { status: 404 });
      return Response.json(stmt);
    }

    if (request.method === 'PATCH') {
      const { filename } = await request.json();
      if (!filename || typeof filename !== 'string') {
        return Response.json({ error: 'filename required' }, { status: 400 });
      }

      const stmt = await env.DB.prepare('SELECT * FROM bank_statements WHERE id = ?').bind(id).first();
      if (!stmt) return new Response('Not found', { status: 404 });

      await env.DB.prepare(
        'UPDATE bank_statements SET filename = ? WHERE id = ?'
      ).bind(filename.trim(), id).run();

      return Response.json({ success: true, filename: filename.trim() });
    }

    if (request.method === 'DELETE') {
      const stmt = await env.DB.prepare('SELECT * FROM bank_statements WHERE id = ?').bind(id).first();
      if (!stmt) return new Response('Not found', { status: 404 });

      // Delete file from R2
      await env.STORAGE.delete(stmt.file_url);
      // Delete transactions + statement
      await env.DB.prepare('DELETE FROM transactions WHERE bank_statement_id = ?').bind(id).run();
      await env.DB.prepare('DELETE FROM bank_statements WHERE id = ?').bind(id).run();

      return new Response(null, { status: 204 });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
