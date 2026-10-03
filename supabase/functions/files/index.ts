// PSCM E-class file service.
// Signs short-lived upload/download links for Cloudflare R2 after checking,
// in the database, that the signed-in user is allowed to touch the file.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function →
// name it "files" → paste this file → Deploy. Then add the four secrets
// R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// (Edge Functions → Secrets). See SETUP.md, part B.

import { AwsClient } from 'npm:aws4fetch@1.0.20';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_BYTES: Record<string, number> = {
  materials: 25 * 1024 * 1024,
  submissions: 5 * 1024 * 1024,
};

const SUBMISSION_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-zip-compressed',
  'image/jpeg',
  'image/png',
]);

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function clean(path: unknown): string | null {
  const p = String(path ?? '').replace(/^r2:/, '');
  if (!p || p.length > 400 || p.includes('..') || p.startsWith('/') || !/^[\w.\-\/]+$/.test(p)) return null;
  return p;
}

async function allowed(req: Request, bucket: string, path: string, action: string): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL');
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const res = await fetch(`${url}/rest/v1/rpc/file_access`, {
    method: 'POST',
    headers: {
      apikey,
      Authorization: req.headers.get('Authorization') ?? '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_bucket: bucket, p_path: path, p_action: action }),
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);

  // Secrets are trimmed: a space or line break pasted with a key breaks signing.
  const env = (k: string) => (Deno.env.get(k) ?? '').trim();
  const account = env('R2_ACCOUNT_ID');
  const accessKeyId = env('R2_ACCESS_KEY_ID');
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY');
  const r2bucket = env('R2_BUCKET');
  if (!accessKeyId || !secretAccessKey || !r2bucket || (!account && !env('R2_ENDPOINT'))) {
    return reply({ error: 'File storage is not set up yet (missing R2 secrets).' }, 500);
  }
  const endpoint = env('R2_ENDPOINT') || `https://${account}.r2.cloudflarestorage.com`;
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply({ error: 'Bad request.' }, 400);
  }
  const action = String(body.action ?? '');
  const bucket = String(body.bucket ?? '');
  if (!(bucket in MAX_BYTES)) return reply({ error: 'Unknown folder.' }, 400);
  const objectUrl = (path: string) => `${endpoint}/${r2bucket}/${bucket}/${path}`;

  try {
    if (action === 'upload') {
      const path = clean(body.path);
      const size = Number(body.size);
      const type = String(body.contentType || 'application/octet-stream');
      if (!path) return reply({ error: 'Invalid file name.' }, 400);
      if (!Number.isFinite(size) || size <= 0) return reply({ error: 'Empty file.' }, 400);
      if (size > MAX_BYTES[bucket]) {
        return reply({ error: `File is larger than ${MAX_BYTES[bucket] / 1024 / 1024} MB.` }, 400);
      }
      if (bucket === 'submissions' && !SUBMISSION_TYPES.has(type)) {
        return reply({ error: 'That file type is not accepted. Upload a PDF, Word, Excel, PowerPoint, ZIP or image file.' }, 400);
      }
      if (!(await allowed(req, bucket, path, 'upload'))) return reply({ error: 'You cannot upload here.' }, 403);
      const signed = await client.sign(
        new Request(`${objectUrl(path)}?X-Amz-Expires=900`, {
          method: 'PUT',
          headers: { 'Content-Type': type, 'Content-Length': String(size) },
        }),
        { aws: { signQuery: true, allHeaders: true } },
      );
      return reply({ url: signed.url, method: 'PUT', headers: { 'Content-Type': type }, path: `r2:${path}` });
    }

    if (action === 'download') {
      const path = clean(body.path);
      if (!path) return reply({ error: 'Invalid file name.' }, 400);
      if (!(await allowed(req, bucket, path, 'download'))) return reply({ error: 'You cannot open this file.' }, 403);
      const name = path.split('/').pop()!.replace(/^[0-9a-f-]{36}-|^\d{10,}-/, '');
      const u = new URL(objectUrl(path));
      u.searchParams.set('X-Amz-Expires', '3600');
      u.searchParams.set('response-content-disposition', `inline; filename="${name}"`);
      const signed = await client.sign(new Request(u.toString(), { method: 'GET' }), { aws: { signQuery: true } });
      return reply({ url: signed.url });
    }

    if (action === 'delete') {
      const list = (Array.isArray(body.paths) ? body.paths : []).map(clean).filter(Boolean) as string[];
      if (!list.length) return reply({ deleted: 0 });
      if (list.length > 1000) return reply({ error: 'Too many files at once.' }, 400);
      if (!(await allowed(req, bucket, list[0], 'delete'))) return reply({ error: 'You cannot delete files.' }, 403);
      let deleted = 0;
      for (let i = 0; i < list.length; i += 20) {
        const results = await Promise.all(
          list.slice(i, i + 20).map((p) => client.fetch(objectUrl(p), { method: 'DELETE' })),
        );
        deleted += results.filter((r) => r.ok || r.status === 404).length;
      }
      return reply({ deleted });
    }

    return reply({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return reply({ error: `File service error: ${(e as Error).message}` }, 500);
  }
});
