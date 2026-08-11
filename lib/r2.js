// Cloudflare R2 (S3-compatible) qua SigV4 tự ký — KHÔNG thêm dependency (nhẹ cho serverless).
// Dùng cho ảnh khách (folder booth/): egress R2 miễn phí -> giảm Cached Egress Supabase.
// Thuật toán SigV4 đã kiểm chứng khớp test-vector chính thức của AWS.

import crypto from 'node:crypto';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function r2Config() {
    return {
        accountId: process.env.R2_ACCOUNT_ID || '',
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
        bucket: process.env.R2_PHOTOS_BUCKET || '',
        publicBase: (process.env.R2_PHOTOS_PUBLIC_URL || '').replace(/\/+$/, ''),
    };
}

export function isR2Configured() {
    const c = r2Config();
    return Boolean(c.accountId && c.accessKeyId && c.secretAccessKey && c.bucket && c.publicBase);
}

// Bật lưu ảnh khách lên R2 khi: PHOTO_STORAGE=r2 VÀ cấu hình R2 đủ. Mặc định (chưa set) -> Supabase.
export function photosUseR2() {
    return String(process.env.PHOTO_STORAGE || '').toLowerCase() === 'r2' && isR2Configured();
}

export function r2PublicUrl(key) {
    return `${r2Config().publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function sha256hex(str) {
    return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}
function hmac(key, str) {
    return crypto.createHmac('sha256', key).update(str, 'utf8').digest();
}

// Ký SigV4, trả header cho 1 request R2 (S3). region 'auto' là chuẩn của R2.
function signHeaders({ method, key, canonicalQuery = '', payloadHash, contentType }) {
    const cfg = r2Config();
    const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
    const canonicalUri = '/' + [cfg.bucket, ...key.split('/')].map(encodeURIComponent).join('/');
    const region = 'auto';
    const service = 's3';

    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const dateStamp = amzDate.slice(0, 8);

    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const scope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(canonicalRequest)}`;

    const kDate = hmac('AWS4' + cfg.secretAccessKey, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

    const headers = {
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
    if (contentType) headers['Content-Type'] = contentType;
    return { url: `https://${host}${canonicalUri}`, headers };
}

// PUT object (dùng UNSIGNED-PAYLOAD qua HTTPS -> khỏi hash file lớn như .webm).
export async function putR2Object(key, body, contentType) {
    const { url, headers } = signHeaders({ method: 'PUT', key, payloadHash: 'UNSIGNED-PAYLOAD', contentType });
    const resp = await fetch(url, { method: 'PUT', headers, body });
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`R2 PUT ${resp.status}: ${text.slice(0, 300)}`);
    }
}

// DELETE object. Trả true nếu xoá xong hoặc object không tồn tại (idempotent).
export async function deleteR2Object(key) {
    const { url, headers } = signHeaders({ method: 'DELETE', key, payloadHash: EMPTY_SHA256 });
    const resp = await fetch(url, { method: 'DELETE', headers });
    // 204 = đã xoá; 404 = không có (coi như xong).
    if (!resp.ok && resp.status !== 404) {
        const text = await resp.text().catch(() => '');
        throw new Error(`R2 DELETE ${resp.status}: ${text.slice(0, 300)}`);
    }
    return true;
}
