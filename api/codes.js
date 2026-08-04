import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from '../lib/supabase.js';
import { requireAuth, hashPassword, verifyPassword, signToken } from '../lib/auth.js';

const PAYMENT_CODE_RETENTION_DAYS = 15;

function randomPaymentCode() {
    const alphabet = '0123456789';
    let code = '';
    for (let i = 0; i < 6; i += 1) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
}

const MAX_PER_BATCH = 100;
const MAX_TOTAL = 500;

async function insertOneCode(supabase, value, expiresAt, createdBy) {
    let lastError = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = randomPaymentCode();
        const { data, error } = await supabase
            .from('payment_codes')
            .insert({ code, value, expires_at: expiresAt, is_used: false, created_by: createdBy || null })
            .select()
            .single();

        if (!error) return data;

        lastError = error;
        if (error.code !== '23505') break; // chỉ retry khi trùng mã (unique violation)
    }
    throw lastError || new Error('Cannot create payment code');
}

async function generateCodes(req, res, supabase) {
    const expiresAt = req.body?.expires_at || null;
    // Token là tùy chọn ở bước này (giữ tương thích UI cũ). Nếu có -> ghi lại nhân viên tạo mã.
    const createdBy = requireAuth(req)?.u || null;

    // Hỗ trợ 2 dạng payload:
    //  - Nhiều mệnh giá: { batches: [{ value, quantity }, ...] }
    //  - Một mệnh giá (cũ):  { value, quantity }
    let batches = [];
    if (Array.isArray(req.body?.batches)) {
        batches = req.body.batches.map((b) => ({
            value: Number(b?.value || 0),
            quantity: Math.min(Math.max(Number(b?.quantity || 1), 1), MAX_PER_BATCH),
        }));
    } else {
        batches = [{
            value: Number(req.body?.value || 0),
            quantity: Math.min(Math.max(Number(req.body?.quantity || 1), 1), MAX_PER_BATCH),
        }];
    }

    batches = batches.filter((b) => Number.isFinite(b.value) && b.value > 0 && b.quantity > 0);
    if (batches.length === 0) {
        return json(res, 400, { error: 'Invalid code value' });
    }

    const total = batches.reduce((sum, b) => sum + b.quantity, 0);
    if (total > MAX_TOTAL) {
        return json(res, 400, { error: `Tổng số mã vượt quá giới hạn ${MAX_TOTAL}.` });
    }

    const created = [];
    for (const batch of batches) {
        for (let i = 0; i < batch.quantity; i += 1) {
            created.push(await insertOneCode(supabase, batch.value, expiresAt, createdBy));
        }
    }

    return json(res, 201, created);
}

async function validateCode(req, res, supabase) {
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!code) {
        return json(res, 400, { valid: false, message: 'Vui lòng nhập mã thanh toán.' });
    }

    const { data, error } = await supabase
        .from('payment_codes')
        .select('*')
        .eq('code', code)
        .maybeSingle();

    if (error) throw error;
    if (!data) return json(res, 404, { valid: false, message: 'Mã thanh toán không tồn tại.' });
    if (data.is_used) return json(res, 400, { valid: false, message: 'Mã thanh toán đã được sử dụng.' });
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
        return json(res, 400, { valid: false, message: 'Mã thanh toán đã hết hạn.' });
    }

    return json(res, 200, {
        valid: true,
        id: data.id,
        code: data.code,
        value: Number(data.value || 0),
        expires_at: data.expires_at,
    });
}

async function markCodeUsed(req, res, supabase) {
    const id = String(req.body?.id || req.query?.id || '').trim();
    // Phiên booth đã dùng mã (để biết "mã dùng cho lượt nào"). Không bắt buộc.
    const sessionId = String(req.body?.session_id || req.body?.sessionId || '').trim() || null;
    if (!id) return json(res, 400, { success: false, message: 'Thiếu ID mã thanh toán.' });

    const { data: current, error: fetchError } = await supabase
        .from('payment_codes')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (fetchError) throw fetchError;
    if (!current) return json(res, 404, { success: false, message: 'Mã thanh toán không tồn tại.' });
    if (current.is_used) return json(res, 400, { success: false, message: 'Mã thanh toán đã được sử dụng.' });
    if (current.expires_at && new Date(current.expires_at).getTime() < Date.now()) {
        return json(res, 400, { success: false, message: 'Mã thanh toán đã hết hạn.' });
    }

    const { data, error } = await supabase
        .from('payment_codes')
        .update({ is_used: true, used_at: new Date().toISOString(), used_session_id: sessionId })
        .eq('id', id)
        .eq('is_used', false)
        .select()
        .single();

    if (error) throw error;
    return json(res, 200, { success: true, code: data });
}

// Gắn phiên booth (album) đã dùng mã — booth gọi ở bước Edit khi sessionId (UUID album) ra đời.
// Không cần token (máy booth không đăng nhập). Ghi đè used_session_id (giá trị null đặt ở bước
// Payment) bằng UUID album thật.
async function setCodeSession(req, res, supabase) {
    const id = String(req.body?.id || '').trim();
    const sessionId = String(req.body?.session_id || req.body?.sessionId || '').trim();
    if (!id || !sessionId) return json(res, 400, { success: false, message: 'Thiếu id hoặc session_id.' });

    const { data, error } = await supabase
        .from('payment_codes')
        .update({ used_session_id: sessionId })
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return json(res, 200, { success: true, code: data });
}

// Ghi chú "mã dùng làm gì" — nhân viên tự điền, sửa được bất cứ lúc nào (kể cả sau khi dùng).
async function setCodeNote(req, res, supabase) {
    const claims = requireAuth(req);
    if (!claims) return json(res, 401, { success: false, message: 'Chưa đăng nhập.' });

    const id = String(req.body?.id || '').trim();
    if (!id) return json(res, 400, { success: false, message: 'Thiếu ID mã thanh toán.' });
    const note = String(req.body?.note ?? '').slice(0, 500);

    const { data, error } = await supabase
        .from('payment_codes')
        .update({ note })
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return json(res, 200, { success: true, code: data });
}

async function cleanupPaymentCodes(req, res, supabase) {
    const secret = process.env.CLEANUP_SECRET;
    // Vercel Cron tự gửi "Authorization: Bearer <CRON_SECRET>" -> chấp nhận cả hai (nếu không cron bị
    // 401 và không bao giờ dọn). Đặt CRON_SECRET trên Vercel để đóng kẽ hở gọi công khai.
    const cronSecret = process.env.CRON_SECRET;
    const auth = String(req.headers.authorization || '');
    const okCleanup = secret && (auth === `Bearer ${secret}` || req.query.secret === secret);
    const okCron = cronSecret && auth === `Bearer ${cronSecret}`;
    if ((secret || cronSecret) && !okCleanup && !okCron) {
        return json(res, 401, { error: 'Unauthorized cleanup request' });
    }

    const cutoffIso = new Date(Date.now() - PAYMENT_CODE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: usedCodes, error: usedError } = await supabase
        .from('payment_codes')
        .delete()
        .eq('is_used', true)
        .lt('used_at', cutoffIso)
        .select('id');

    if (usedError) throw usedError;

    const { data: expiredCodes, error: expiredError } = await supabase
        .from('payment_codes')
        .delete()
        .eq('is_used', false)
        .not('expires_at', 'is', null)
        .lt('expires_at', cutoffIso)
        .select('id');

    if (expiredError) throw expiredError;

    return json(res, 200, {
        success: true,
        retention_days: PAYMENT_CODE_RETENTION_DAYS,
        cutoff: cutoffIso,
        deleted: {
            used: Array.isArray(usedCodes) ? usedCodes.length : 0,
            expired: Array.isArray(expiredCodes) ? expiredCodes.length : 0,
        },
    });
}

// =====================================================================
// TÀI KHOẢN NHÂN VIÊN — gộp chung vào endpoint này vì Vercel Hobby giới hạn
// 12 serverless functions. Phân biệt bằng action 'login' / 'staff-*'.
// =====================================================================

const publicAccount = (row) => ({
    id: row.id,
    username: row.username,
    display_name: row.display_name || row.username,
    role: row.role,
    active: row.active,
    created_at: row.created_at,
});

// Chặn quyền admin cho thao tác quản lý. Trả claims nếu OK, ngược lại đã tự gửi lỗi -> null.
function guardAdmin(req, res) {
    const claims = requireAuth(req);
    if (!claims) {
        json(res, 401, { error: 'Chưa đăng nhập hoặc phiên đã hết hạn.' });
        return null;
    }
    if (claims.r !== 'admin') {
        json(res, 403, { error: 'Chỉ admin mới được thao tác.' });
        return null;
    }
    return claims;
}

async function login(req, res, supabase) {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) {
        return json(res, 400, { error: 'Vui lòng nhập tên đăng nhập và mật khẩu.' });
    }

    // 1) Tài khoản trong DB.
    const { data, error } = await supabase
        .from('staff_accounts')
        .select('*')
        .eq('username', username)
        .maybeSingle();
    if (error) throw error;

    if (data) {
        if (!data.active) return json(res, 403, { error: 'Tài khoản đã bị khóa.' });
        if (!verifyPassword(password, data.password_hash)) {
            return json(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' });
        }
        const token = signToken({ u: data.username, r: data.role });
        return json(res, 200, {
            token,
            username: data.username,
            display_name: data.display_name || data.username,
            role: data.role,
        });
    }

    // 2) Admin bootstrap từ biến môi trường (dùng khi CHƯA có tài khoản nào, hoặc giữ 1 admin
    //    "phao cứu sinh"). Đặt ADMIN_USERNAME/ADMIN_PASSWORD trên Vercel.
    const envUser = globalThis.process?.env?.ADMIN_USERNAME;
    const envPass = globalThis.process?.env?.ADMIN_PASSWORD;
    if (envUser && envPass && username === envUser && password === envPass) {
        const token = signToken({ u: envUser, r: 'admin' });
        return json(res, 200, { token, username: envUser, display_name: 'Quản trị', role: 'admin' });
    }

    return json(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' });
}

async function listStaff(req, res, supabase) {
    if (!guardAdmin(req, res)) return undefined;
    const { data, error } = await supabase
        .from('staff_accounts')
        .select('*')
        .order('created_at', { ascending: true });
    if (error) throw error;
    return json(res, 200, Array.isArray(data) ? data.map(publicAccount) : []);
}

async function createStaff(req, res, supabase) {
    if (!guardAdmin(req, res)) return undefined;
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const displayName = String(req.body?.display_name || '').trim() || username;
    const role = req.body?.role === 'admin' ? 'admin' : 'staff';

    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
        return json(res, 400, { error: 'Tên đăng nhập 3-32 ký tự, chỉ chữ thường/số/._-' });
    }
    if (password.length < 6) {
        return json(res, 400, { error: 'Mật khẩu tối thiểu 6 ký tự.' });
    }

    const { data, error } = await supabase
        .from('staff_accounts')
        .insert({ username, password_hash: hashPassword(password), display_name: displayName, role })
        .select()
        .single();

    if (error) {
        if (error.code === '23505') return json(res, 409, { error: 'Tên đăng nhập đã tồn tại.' });
        throw error;
    }
    return json(res, 201, publicAccount(data));
}

async function toggleStaff(req, res, supabase) {
    if (!guardAdmin(req, res)) return undefined;
    const id = String(req.body?.id || '').trim();
    const active = Boolean(req.body?.active);
    if (!id) return json(res, 400, { error: 'Thiếu ID tài khoản.' });

    const { data, error } = await supabase
        .from('staff_accounts')
        .update({ active })
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return json(res, 200, publicAccount(data));
}

async function resetStaffPassword(req, res, supabase) {
    if (!guardAdmin(req, res)) return undefined;
    const id = String(req.body?.id || '').trim();
    const password = String(req.body?.password || '');
    if (!id) return json(res, 400, { error: 'Thiếu ID tài khoản.' });
    if (password.length < 6) return json(res, 400, { error: 'Mật khẩu tối thiểu 6 ký tự.' });

    const { data, error } = await supabase
        .from('staff_accounts')
        .update({ password_hash: hashPassword(password) })
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return json(res, 200, publicAccount(data));
}

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const supabase = getSupabaseAdmin();

        if (req.method === 'POST') {
            const action = String(req.body?.action || req.query?.action || '').trim();
            // --- mã thanh toán ---
            if (action === 'generate') return generateCodes(req, res, supabase);
            if (action === 'validate') return validateCode(req, res, supabase);
            if (action === 'use') return markCodeUsed(req, res, supabase);
            if (action === 'set-session') return setCodeSession(req, res, supabase);
            if (action === 'set-note') return setCodeNote(req, res, supabase);
            if (action === 'cleanup') return cleanupPaymentCodes(req, res, supabase);
            // --- tài khoản nhân viên ---
            if (action === 'login') return login(req, res, supabase);
            if (action === 'staff-list') return listStaff(req, res, supabase);
            if (action === 'staff-create') return createStaff(req, res, supabase);
            if (action === 'staff-toggle') return toggleStaff(req, res, supabase);
            if (action === 'staff-reset') return resetStaffPassword(req, res, supabase);
            return json(res, 400, { error: 'Invalid action' });
        }

        if (req.method !== 'GET') return methodNotAllowed(res);

        const getAction = String(req.query?.action || '').trim();
        if (getAction === 'cleanup') return cleanupPaymentCodes(req, res, supabase);
        if (getAction === 'staff-list') return listStaff(req, res, supabase);

        const { data, error } = await supabase
            .from('payment_codes')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        return json(res, 200, Array.isArray(data) ? data : []);
    } catch (error) {
        console.error('Fetch payment codes failed:', error);
        return json(res, 500, { error: error.message || 'Fetch payment codes failed' });
    }
}
