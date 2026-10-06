// Giới hạn số lần thử SAI theo IP (nhập mã thanh toán, đăng nhập trang quản lý) — chặn dò mã 6 số / dò
// mật khẩu. Đếm ở bảng rate_limits trên Supabase để mọi instance serverless dùng chung; bảng chưa tạo
// thì tạm đếm trong bộ nhớ của instance (yếu hơn: Vercel có thể chạy nhiều instance) và log nhắc tạo bảng.
// Lỗi của chính bộ đếm KHÔNG được chặn khách: lỗi thì coi như chưa vượt (ưu tiên khách trả tiền được).
//
// SQL tạo bảng (chạy 1 lần trong Supabase SQL Editor) — xem supabase_schema.sql:
//   create table if not exists rate_limits (key text primary key, count integer not null default 0,
//     reset_at timestamptz not null);
//   alter table rate_limits enable row level security;   -- không policy: chỉ service role đọc/ghi

const memory = new Map();
let warned = false;

const isMissingTable = (error) => /Could not find the table|schema cache|does not exist|42P01/i
    .test(`${error?.message || ''} ${error?.code || ''}`);

function warnOnce() {
    if (warned) return;
    warned = true;
    console.warn('rate_limits: chua co bang tren Supabase -> tam dem trong bo nho instance');
}

// IP khách do Vercel gắn (x-real-ip / x-forwarded-for do Vercel ghi đè, khách không tự đặt được).
export function clientIp(req) {
    const h = req.headers || {};
    const ip = h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress;
    return String(ip || 'unknown').trim();
}

async function readEntry(supabase, key) {
    const { data, error } = await supabase
        .from('rate_limits')
        .select('key, count, reset_at')
        .eq('key', key)
        .maybeSingle();
    if (error) {
        if (isMissingTable(error)) return { fallback: true };
        throw error;
    }
    return { row: data ? { count: Number(data.count || 0), resetAt: Date.parse(data.reset_at) } : null };
}

// Số giây còn bị khoá (> 0) nếu key đã sai đủ `limit` lần trong cửa sổ hiện tại, ngược lại 0.
export async function lockedSeconds(supabase, key, limit) {
    try {
        const now = Date.now();
        const entry = await readEntry(supabase, key);
        if (entry.fallback) warnOnce();
        const row = entry.fallback ? memory.get(key) : entry.row;
        if (!row || !(row.resetAt > now) || row.count < limit) return 0;
        return Math.ceil((row.resetAt - now) / 1000);
    } catch (error) {
        console.error('rate_limits: doc loi -> bo qua gioi han', error);
        return 0;
    }
}

// Ghi thêm một lần sai. Cửa sổ bắt đầu từ lần sai đầu tiên, hết cửa sổ thì đếm lại từ 1.
export async function recordFailure(supabase, key, windowMs) {
    try {
        const now = Date.now();
        const entry = await readEntry(supabase, key);
        if (entry.fallback) {
            warnOnce();
            const cur = memory.get(key);
            if (!cur || !(cur.resetAt > now)) memory.set(key, { count: 1, resetAt: now + windowMs });
            else cur.count += 1;
            if (memory.size > 5000) {
                for (const [k, v] of memory) if (!(v.resetAt > now)) memory.delete(k);
            }
            return;
        }
        const cur = entry.row;
        const fresh = !cur || !(cur.resetAt > now);
        const { error } = await supabase
            .from('rate_limits')
            .upsert({
                key,
                count: fresh ? 1 : cur.count + 1,
                reset_at: new Date(fresh ? now + windowMs : cur.resetAt).toISOString(),
            }, { onConflict: 'key' });
        if (error) throw error;
    } catch (error) {
        console.error('rate_limits: ghi loi -> bo qua', error);
    }
}

// Dọn dòng đã hết hạn (gọi từ cron dọn mã hằng ngày). Bảng chưa có thì thôi.
export async function cleanupRateLimits(supabase) {
    try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { error } = await supabase.from('rate_limits').delete().lt('reset_at', cutoff);
        if (error && !isMissingTable(error)) throw error;
    } catch (error) {
        console.error('rate_limits: don loi', error);
    }
}
