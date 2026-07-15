// Auth utility for Cloudflare Pages Functions
// Checks X-User-Email header against authorized_users table

/**
 * Authenticate an API request.
 * @param {Request} request
 * @param {object} env - Cloudflare env bindings
 * @param {'read'|'write'} requiredAccess - minimum access level
 * @returns {{ email: string, role: string } | null}
 */
export async function authenticate(request, env, requiredAccess = 'read') {
  const userEmail = (request.headers.get('X-User-Email') || '').toLowerCase().trim();
  if (!userEmail) return null;

  // Check against authorized_users
  const user = await env.DB.prepare(
    'SELECT email, role FROM authorized_users WHERE email = ?'
  ).bind(userEmail).first();

  if (!user) return null;

  // Check role-based access for write operations
  if (requiredAccess === 'write' && user.role === 'viewer') return null;

  return { email: user.email, role: user.role };
}
