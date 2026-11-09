import { createHmac, createHash } from "node:crypto";

const BUCKET = "studio-apks";
const hex = (value) => Buffer.from(value).toString("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
const sha256 = (value) => hex(createHash("sha256").update(value).digest());
const enc = (value) => encodeURIComponent(value).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function presign(method, key, expires = 900) {
  const endpoint = new URL(process.env.AWS_ENDPOINT_URL_S3);
  const region = process.env.AWS_REGION || "us-east-2";
  const host = endpoint.host;
  const path = `/${BUCKET}/${key.split("/").map(enc).join("/")}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\\.\\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/s3/aws4_request`;
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${process.env.AWS_ACCESS_KEY_ID}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host"
  };
  const canonicalQuery = Object.keys(params).sort().map(k => `${enc(k)}=${enc(params[k])}`).join("&");
  const canonicalRequest = `${method}\n${path}\n${canonicalQuery}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
  const kDate = hmac("AWS4" + process.env.AWS_SECRET_ACCESS_KEY, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = hex(hmac(kSigning, stringToSign));
  return `${endpoint.protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

async function githubUser(token) {
  if (!token) throw new Error("GitHub token required");
  const response = await fetch("https://api.github.com/user", { headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Studio-App-Neon-Backend"
  }});
  if (!response.ok) throw new Error("GitHub token validation failed");
  return (await response.json()).login;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  }});
}

export default { async fetch(request) {
  if (request.method === "OPTIONS") return json({});
  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\\s+/i, "");
    const login = await githubUser(token);
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/upload-url") {
      const body = await request.json();
      const fileName = String(body.fileName || "app.apk").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);
      const key = `${login}/${crypto.randomUUID()}-${fileName}`;
      return json({ key, uploadUrl: presign("PUT", key, 900), expiresIn: 900 });
    }

    if (request.method === "GET" && url.pathname === "/download-url") {
      const key = url.searchParams.get("key") || "";
      if (!key.startsWith(`${login}/`) || key.includes("..")) return json({ error: "Invalid file key" }, 403);
      return json({ key, downloadUrl: presign("GET", key, 3600), expiresIn: 3600 });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: error.message || "Request failed" }, 400);
  }
}};
