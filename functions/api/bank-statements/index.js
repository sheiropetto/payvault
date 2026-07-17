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
      // Check if this is a bulk auto-rename request
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const body = await request.json();
        if (body.action === 'auto-rename') {
          return handleAutoRename(env, body.company_id);
        }
        if (body.action === 'cleanup-pdfs') {
          return handleCleanupPDFs(env, body.company_id);
        }
      }

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

// ─── Helpers ───

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

export function toProperFilename(filename, month, year, fileType) {
  const ext = fileType || (filename.endsWith('.csv') ? 'csv' : 'pdf');
  if (month && year) {
    return `${MONTHS[month - 1]} ${year}.${ext}`;
  }
  if (year) {
    return `Statement ${year}.${ext}`;
  }
  return filename; // keep original if no data
}

async function handleAutoRename(env, companyId) {
  let query = 'SELECT id, filename, file_type, month, year FROM bank_statements WHERE month IS NOT NULL AND year IS NOT NULL';
  const params = [];
  if (companyId) {
    query += ' AND company_id = ?';
    params.push(companyId);
  }
  const { results } = await env.DB.prepare(query).bind(...params).all();

  let renamed = 0;
  for (const stmt of results) {
    const proper = toProperFilename(stmt.filename, stmt.month, stmt.year, stmt.file_type);
    if (proper !== stmt.filename) {
      await env.DB.prepare('UPDATE bank_statements SET filename = ? WHERE id = ?')
        .bind(proper, stmt.id).run();
      renamed++;
    }
  }

  return Response.json({ success: true, renamed, total: results.length });
}

async function handleCleanupPDFs(env, companyId) {
  let query = 'SELECT id, file_url FROM bank_statements WHERE status = \'done\' AND file_url IS NOT NULL';
  const params = [];
  if (companyId) {
    query += ' AND company_id = ?';
    params.push(companyId);
  }
  const { results } = await env.DB.prepare(query).bind(...params).all();

  let deleted = 0;
  for (const stmt of results) {
    try {
      await env.STORAGE.delete(stmt.file_url);
      await env.DB.prepare('UPDATE bank_statements SET file_url = NULL WHERE id = ?')
        .bind(stmt.id).run();
      deleted++;
    } catch (err) {
      console.error(`Failed to delete ${stmt.file_url}:`, err.message);
    }
  }

  return Response.json({ success: true, deleted, total: results.length });
}
