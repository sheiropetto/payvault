import { authenticate } from '../../utils/auth';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const companyId = url.searchParams.get('company_id');

  try {
    const user = await authenticate(request, env, request.method === 'GET' ? 'read' : 'write');
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (request.method === 'GET') {
      let query = `SELECT bs.*, c.name as company_name
                   FROM bank_statements bs
                   JOIN companies c ON c.id = bs.company_id`;
      const params = [];

      if (companyId) {
        query += ' WHERE bs.company_id = ?';
        params.push(companyId);
      }

      query += ' ORDER BY bs.uploaded_at DESC';

      const { results } = await env.DB.prepare(query).bind(...params).all();
      return Response.json(results);
    }

    if (request.method === 'POST') {
      const formData = await request.formData();
      const file = formData.get('file');
      const companyId = formData.get('company_id');

      if (!file || !companyId) {
        return Response.json({ error: 'File and company_id required' }, { status: 400 });
      }

      const ext = file.name.endsWith('.csv') ? 'csv' : 'pdf';
      const key = `statements/${companyId}/${Date.now()}-${file.name}`;

      // Upload to R2
      await env.STORAGE.put(key, file.stream(), {
        httpMetadata: { contentType: file.type },
      });

      const { results } = await env.DB.prepare(
        `INSERT INTO bank_statements (company_id, filename, file_type, file_url, file_size)
         VALUES (?, ?, ?, ?, ?) RETURNING *`
      ).bind(companyId, file.name, ext, key, file.size).all();

      return Response.json(results[0], { status: 201 });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
