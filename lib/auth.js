import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { json } from './supabase.js';

// Token sống 12 tiếng (đủ 1 ca làm việc). Hết hạn -> đăng nhập lại.
const TOKEN_TTL_SECONDS = 60 * 60 * 12;
// Khi khách tick "Ghi nhớ đăng nhập": token sống 30 ngày (không phải chỉ 1 ca).
export const REMEMBER_TTL_SECONDS = 60 * 60 * 24 * 30;
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

const envAdminUsername = () => String(globalThis.process?.env?.ADMIN_USERNAME || '').trim().toLowerCase();

// Đối chiếu token với staff_accounts NGAY lúc gọi: khoá / XOÁ tài khoản hay đổi quyền có hiệu lực
// ngay, không chờ token (tới 30 ngày nếu "Ghi nhớ") hết hạn. Quyền lấy theo DB, không theo token.
// Không có dòng DB chỉ hợp lệ khi đúng là admin bootstrap (ADMIN_USERNAME trên Vercel). Trước
// 2026-10-06 mọi token không có dòng DB đều được coi là admin bootstrap -> tài khoản đã bị XOÁ vẫn
// dùng token cũ được (xoá còn yếu hơn khoá).
// Trả { claims } nếu hợp lệ, ngược lại { status, message }.
export async function checkAccount(supabase, claims) {
    const { data, error } = await supabase
        .from('staff_accounts')
        .select('active, role')
        .eq('username', claims.u)
        .maybeSingle();
    if (error) throw error;
    if (data) {
        if (data.active === false) return { status: 403, message: 'Tài khoản đã bị khóa.' };
        return { claims: { ...claims, r: data.role } };
    }
    const envUser = envAdminUsername();
    if (envUser && claims.r === 'admin' && String(claims.u || '').toLowerCase() === envUser) {
        return { claims };
    }
    return { status: 403, message: 'Tài khoản không còn tồn tại.' };
}

// Dữ liệu quản trị trên cloud (doanh thu, danh sách lượt chụp, danh sách booth, tạo mã, quản lý
// nhân viên) CHỈ cho admin đã đăng nhập. Trước 2026-10-03 các endpoint này mở cho bất kỳ ai, còn lệnh
// xoá doanh thu chỉ cần mã 8686 viết cứng — đọc được ngay trong repo công khai và trong mã JS của trang.
// Trả claims nếu OK; ngược lại đã tự trả 401/403 và trả null.
export async function requireActiveAdmin(req, res, supabase) {
    const claims = requireAuth(req);
    if (!claims) {
        json(res, 401, { error: 'Chưa đăng nhập hoặc phiên đã hết hạn.' });
        return null;
    }
    if (claims.r !== 'admin') {
        json(res, 403, { error: 'Chỉ admin mới được xem hoặc thao tác mục này.' });
        return null;
    }
    const account = await checkAccount(supabase, claims);
    if (!account.claims) {
        json(res, account.status, { error: account.message });
        return null;
    }
    if (account.claims.r !== 'admin') {
        json(res, 403, { error: 'Tài khoản không còn quyền admin.' });
        return null;
    }
    return account.claims;
}

// Kiểm lại mật khẩu của CHÍNH người đang đăng nhập — xác nhận thao tác không hoàn tác được (xoá
// doanh thu): lộ token thôi chưa đủ để xoá. Cùng quy tắc với đăng nhập ở api/codes.js.
export async function verifyAccountPassword(supabase, username, password) {
    const u = String(username || '').trim().toLowerCase();
    const p = String(password || '');
    if (!u || !p) return false;
    const { data, error } = await supabase
        .from('staff_accounts')
        .select('password_hash, active')
        .eq('username', u)
        .maybeSingle();
    if (error) throw error;
    if (data) return data.active !== false && verifyPassword(p, data.password_hash);
    const envUser = envAdminUsername();
    const envPass = globalThis.process?.env?.ADMIN_PASSWORD || '';
    if (!envUser || !envPass || u !== envUser) return false;
    const a = Buffer.from(p);
    const b = Buffer.from(envPass);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
