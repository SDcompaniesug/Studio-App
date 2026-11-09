import { createHmac, createHash } from 'node:crypto';

const BUCKET = 'studio-apks';
const MAX_TTL = 3600;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function hmac(key, value, encoding) {
  const result = createHmac('sha256', key).update(value, 'utf8').digest();
  return encoding === 'hex' ? result.toString('hex') : result;
}

function encodePath(path) {
  return path.split('/').map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
}

function encodeQuery(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function presign(method, key, expires = MAX_TTL) {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || 'us-east-2';
  if (!endpoint || !accessKey || !secretKey) throw new Error('Neon Storage credentials are not available in this function.');

  const base = new URL(endpoint);
  const host = base.host;
  const path = base.pathname.replace(/\/$/, '') + '/' + BUCKET + '/' + encodePath(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = dateStamp + '/' + region + '/s3/aws4_request';
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': accessKey + '/' + scope,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params).sort().map((name) => encodeQuery(name) + '=' + encodeQuery(params[name])).join('&');
  const canonicalRequest = method + '\n' + path + '\n' + canonicalQuery + '\nhost:' + host + '\n\nhost\nUNSIGNED-PAYLOAD';
  const payloadHash = createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
  const stringToSign = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + scope + '\n' + payloadHash;
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + secretKey, dateStamp), region), 's3'), 'aws4_request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  return base.origin + path + '?' + canonicalQuery + '&X-Amz-Signature=' + signature;
}

async function verifyRepoToken(request, repo) {
  const auth = request.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const response = await fetch('https://api.github.com/repos/' + repo, {
    headers: {
      authorization: 'Bearer ' + match[1],
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'StudioApp-Neon-APK-API',
    },
  });
  return response.ok;
}

function validRepo(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

function validKey(key, repo) {
  return typeof key === 'string' && key.length <= 512 &&
    (key.startsWith('apks/' + repo + '/') || key.startsWith('logs/' + repo + '/')) &&
    !key.split('/').includes('..');
}

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname.endsWith('/health')) {
        return json({ ok: true, service: 'studio-apk-api' });
      }

      let body = {};
      if (request.method === 'POST') {
        try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
      }
      const repo = request.method === 'GET' ? url.searchParams.get('repo') : body.repo;
      const key = request.method === 'GET' ? url.searchParams.get('key') : body.key;
      if (!validRepo(repo) || !validKey(key, repo)) {
        return json({ error: 'Invalid repository or APK object key' }, 400);
      }
      if (!await verifyRepoToken(request, repo)) {
        return json({ error: 'GitHub token cannot access this repository' }, 403);
      }

      if (request.method === 'POST' &&
          (url.pathname.endsWith('/upload-url') || url.pathname.endsWith('/logs-upload-url'))) {
        return json({ key, url: presign('PUT', key), method: 'PUT', expiresIn: MAX_TTL });
      }
      if (request.method === 'GET' &&
          (url.pathname.endsWith('/download-url') || url.pathname.endsWith('/logs-download-url'))) {
        return json({ key, url: presign('GET', key), method: 'GET', expiresIn: MAX_TTL });
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      return json({ error: error?.message || 'Internal server error' }, 500);
    }
  },
};
