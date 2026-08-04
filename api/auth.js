import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from '../lib/supabase.js';
import { hashPassword, verifyPassword, signToken, requireAuth } from '../lib/auth.js';

const publicAccount = (row) => ({
    id: row.id,
    username: row.username,
    display_name: row.display_name || row.username,
    role: row.role,
    active: row.active,
    created_at: row.created_at,
});

// Chặn quyền admin cho các thao tác quản lý. Trả claims nếu OK, ngược lại đã tự gửi lỗi -> null.
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

    // 2) Admin bootstrap từ biến môi trường (dùng khi CHƯA có tài khoản nào trong DB,
    //    hoặc luôn giữ 1 admin "phao cứu sinh"). Đặt ADMIN_USERNAME/ADMIN_PASSWORD trên Vercel.
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

async function resetPassword(req, res, supabase) {
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
    if (req.method !== 'POST' && req.method !== 'GET') return methodNotAllowed(res);

    try {
        const supabase = getSupabaseAdmin();
        const action = String(req.body?.action || req.query?.action || '').trim();

        if (req.method === 'GET' || action === 'list') return listStaff(req, res, supabase);

        switch (action) {
            case 'login': return login(req, res, supabase);
            case 'create': return createStaff(req, res, supabase);
            case 'toggle': return toggleStaff(req, res, supabase);
            case 'reset-password': return resetPassword(req, res, supabase);
            default: return json(res, 400, { error: 'Invalid action' });
        }
    } catch (error) {
        console.error('Auth handler failed:', error);
        return json(res, 500, { error: error.message || 'Auth request failed' });
    }
}
