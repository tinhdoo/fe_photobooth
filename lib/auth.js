import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

// Token sống 12 tiếng (đủ 1 ca làm việc). Hết hạn -> đăng nhập lại.
const TOKEN_TTL_SECONDS = 60 * 60 * 12;
const PBKDF2_ITER = 100000;

const nowSeconds = () => Math.floor(Date.now() / 1000);

const b64url = (buf) => Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const b64urlJson = (obj) => b64url(JSON.stringify(obj));
const fromB64url = (str) => Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function getSecret() {
    const s = globalThis.process?.env?.AUTH_SECRET;
    if (!s) throw new Error('Missing AUTH_SECRET');
    return s;
}

// ----- Mật khẩu: pbkdf2-sha256, lưu dạng "pbkdf2$<iter>$<salt_hex>$<hash_hex>" -----
export function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITER, 32, 'sha256');
    return `pbkdf2$${PBKDF2_ITER}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
    try {
        const [scheme, iterStr, saltHex, hashHex] = String(stored).split('$');
        if (scheme !== 'pbkdf2') return false;
        const iter = parseInt(iterStr, 10);
        const salt = Buffer.from(saltHex, 'hex');
        const expected = Buffer.from(hashHex, 'hex');
        const actual = crypto.pbkdf2Sync(String(password), salt, iter, expected.length, 'sha256');
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

// ----- Token: "<payload_b64url>.<hmac_b64url>" (payload = {u, r, exp}) -----
export function signToken(claims, ttl = TOKEN_TTL_SECONDS) {
    const body = { u: claims.u, r: claims.r, exp: nowSeconds() + ttl };
    const payload = b64urlJson(body);
    const sig = b64url(crypto.createHmac('sha256', getSecret()).update(payload).digest());
    return `${payload}.${sig}`;
}

export function verifyToken(token) {
    try {
        const [payload, sig] = String(token).split('.');
        if (!payload || !sig) return null;
        const expected = b64url(crypto.createHmac('sha256', getSecret()).update(payload).digest());
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
        const body = JSON.parse(fromB64url(payload).toString('utf8'));
        if (!body.exp || body.exp < nowSeconds()) return null;
        return body; // { u, r, exp }
    } catch {
        return null;
    }
}

export function getBearer(req) {
    const auth = String(req.headers?.authorization || '');
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : null;
}

// Trả claims nếu token hợp lệ, ngược lại null.
export function requireAuth(req) {
    const token = getBearer(req);
    return token ? verifyToken(token) : null;
}
