import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from '../lib/supabase.js';

function isMissingTable(error) {
    return /Could not find the table|schema cache|does not exist/i.test(error?.message || '');
}

function toNumber(value) {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num : 0;
}

function txDate(tx) {
    return tx.used_at || tx.paid_at || tx.created_at || new Date().toISOString();
}

function inRange(tx, startDate, endDate) {
    const time = new Date(txDate(tx)).getTime();
    if (startDate && time < new Date(startDate).getTime()) return false;
    if (endDate && time > new Date(endDate).getTime()) return false;
    return true;
}

function matchesMethod(tx, method) {
    if (!method) return true;
    const current = String(tx.payment_method || tx.provider || '').toLowerCase();
    if (method === 'qr') return current.includes('qr') || current.includes('sepay');
    if (method === 'code') return current.includes('code');
    return current === method;
}

function methodLabel(method) {
    const value = String(method || 'cash').toLowerCase();
    if (value === 'cash') return 'Tiền mặt';
    if (value === 'qr' || value === 'sepay') return 'Chuyển khoản QR';
    if (value === 'code') return 'Mã thanh toán';
    if (value === 'code+cash') return 'Mã + tiền mặt';
    if (value === 'code+qr') return 'Mã + QR';
    return method || 'Không xác định';
}

function detailLabel(method, paymentCode, sepayCode) {
    const parts = [];
    if (paymentCode) parts.push(`Mã: ${paymentCode}`);
    if (sepayCode) parts.push(`QR: ${sepayCode}`);
    if (!parts.length && (method === 'qr' || method === 'sepay')) parts.push('SePay');
    return parts.join(' • ');
}

function normalizeMeta(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
}

function pickPaymentCode(row, meta = normalizeMeta(row?.meta_data)) {
    return meta.payment_code
        || meta.paymentCode
        || meta.code
        || meta.voucher_code
        || meta.voucherCode
        || row?.payment_code
        || null;
}

function pickSepayCode(row, meta = normalizeMeta(row?.meta_data)) {
    return meta.sepay_order_code
        || meta.sepayOrderCode
        || meta.sepay_code
        || row?.sepay_order_code
        || row?.code
        || null;
}

function normalizeSessionTransaction(session, source = 'session') {
    const meta = normalizeMeta(session.meta_data);
    const paymentMethod = session.payment_method || meta.payment_method || 'cash';
    const paymentCode = pickPaymentCode(session, meta);
    const sepayCode = pickSepayCode(session, meta);
    const id = session.uuid || session.session_id || session.id;

    return {
        id,
        code: paymentCode || sepayCode || paymentMethod,
        value: toNumber(session.amount),
        status: session.status || 'active',
        used_at: session.created_at || session.updated_at || session.paid_at,
        created_at: session.created_at || session.updated_at || session.paid_at,
        payment_method: paymentMethod,
        payment_code: paymentCode,
        payment_code_value: meta.payment_code_value || meta.paymentCodeValue || null,
        payment_code_applied: meta.payment_code_applied || meta.paymentCodeApplied || null,
        sepay_order_code: sepayCode,
        method_label: methodLabel(paymentMethod),
        detail_label: detailLabel(paymentMethod, paymentCode, sepayCode),
        source,
        device_id: meta.device_id || null,
    };
}

async function resolveBucket(supabase) {
    const configuredBucket = process.env.SUPABASE_BUCKET || 'tomato';
    const { data, error } = await supabase.storage.listBuckets();
    if (error) throw error;

    const buckets = Array.isArray(data) ? data : [];
    if (buckets.some((item) => item.name === configuredBucket)) return configuredBucket;
    if (buckets.length > 0) return buckets[0].name;
    return configuredBucket;
}

async function listFilesRecursive(supabase, bucket, prefix) {
    const result = [];
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) return result;

    const items = Array.isArray(data) ? data : [];
    for (const item of items) {
        const path = `${prefix}/${item.name}`;
        if (item.id) {
            result.push({ ...item, path });
        } else {
            result.push(...await listFilesRecursive(supabase, bucket, path));
        }
    }
    return result;
}

async function removeStoragePaths(supabase, bucket, paths) {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
    let deleted = 0;

    for (let i = 0; i < uniquePaths.length; i += 100) {
        const batch = uniquePaths.slice(i, i + 100);
        const { error } = await supabase.storage.from(bucket).remove(batch);
        if (!error) deleted += batch.length;
    }

    return deleted;
}

// Xóa sạch mọi file dưới 1 prefix. Lặp nhiều lượt (list giới hạn 1000) cho tới khi rỗng,
// vì mỗi lượt đã xóa sẽ giải phóng chỗ cho lượt sau — an toàn cả khi thư mục có > 1000 file.
async function wipeStoragePrefix(supabase, bucket, prefix, maxPasses = 25) {
    let removed = 0;
    for (let pass = 0; pass < maxPasses; pass += 1) {
        const files = await listFilesRecursive(supabase, bucket, prefix);
        if (files.length === 0) break;
        removed += await removeStoragePaths(supabase, bucket, files.map((file) => file.path));
    }
    return removed;
}

// Xóa toàn bộ bản ghi 1 bảng theo từng trang (delete .in('id', ...)) — không phụ thuộc
// kiểu id (uuid/bigint). Bỏ qua nếu bảng không tồn tại.
async function deleteAllRows(supabase, table, maxPages = 100) {
    let total = 0;
    for (let page = 0; page < maxPages; page += 1) {
        const { data, error } = await supabase.from(table).select('id').limit(1000);
        if (error && isMissingTable(error)) return total;
        if (error) throw error;

        const ids = (data || []).map((row) => row.id).filter((id) => id !== null && id !== undefined);
        if (ids.length === 0) break;

        const { error: deleteError } = await supabase.from(table).delete().in('id', ids);
        if (deleteError) throw deleteError;
        total += ids.length;
        if (ids.length < 1000) break;
    }
    return total;
}

// Hard reset: xóa THẬT mọi dữ liệu liên quan doanh thu khỏi database + storage.
// KHÔNG THỂ KHÔI PHỤC. Gồm: mã thanh toán, session, giao dịch QR, upload mobile,
// và toàn bộ file ảnh/motion/session-json trong storage.
async function hardResetRevenueData(supabase) {
    const bucket = await resolveBucket(supabase);

    const deletedCodes = await deleteAllRows(supabase, 'payment_codes');
    const deletedSessions = await deleteAllRows(supabase, 'photo_sessions');
    const deletedPayments = await deleteAllRows(supabase, 'payments');
    const deletedMobileUploads = await deleteAllRows(supabase, 'mobile_uploads');

    let deletedStorageObjects = 0;
    for (const prefix of ['booth', 'cloud', 'mobile', 'sessions']) {
        deletedStorageObjects += await wipeStoragePrefix(supabase, bucket, prefix);
    }

    return {
        deletedCodes,
        deletedSessions,
        deletedPayments,
        deletedMobileUploads,
        deletedStorageObjects,
    };
}

async function listStorageSessions(supabase) {
    const bucket = await resolveBucket(supabase);
    // Session được ghi CẢ vào bảng photo_sessions (đã phân trang đầy đủ ở listDbSessions) LẪN storage
    // JSON -> nguồn storage này chỉ là BẢN TRÙNG (dedup theo uuid trong mergeTransactions). Vì vậy KHÔNG
    // phân trang/không tải hết ở đây (tránh tải hàng nghìn JSON mỗi lần mở dashboard -> timeout serverless);
    // giữ trần 1000 gần nhất như cũ. Doanh thu đầy đủ đã lấy từ DB.
    const { data, error } = await supabase.storage
        .from(bucket)
        .list('sessions', {
            limit: 1000,
            sortBy: { column: 'created_at', order: 'desc' },
        });

    if (error) return [];

    const files = Array.isArray(data) ? data.filter((item) => item.name?.endsWith('.json')) : [];
    const rows = await Promise.all(files.map(async (file) => {
        const { data: blob, error: downloadError } = await supabase.storage
            .from(bucket)
            .download(`sessions/${file.name}`);

        if (downloadError) return null;

        try {
            const session = JSON.parse(await blob.text());
            return normalizeSessionTransaction({
                ...session,
                uuid: session.uuid || file.name.replace(/\.json$/, ''),
                created_at: session.created_at || file.created_at || file.updated_at,
            }, 'storage-session');
        } catch {
            return null;
        }
    }));

    return rows.filter(Boolean);
}

// Nạp HẾT dòng theo trang. PostgREST mặc định chặn ~1000 dòng/req -> nếu chỉ 1 query, doanh thu bị
// THIẾU khi vượt 1000 giao dịch. buildPage(from, to) trả 1 query đã .range(). Dừng khi trang < pageSize.
async function fetchAllPaged(buildPage, pageSize = 1000, maxPages = 500) {
    const all = [];
    for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const { data, error } = await buildPage(from, from + pageSize - 1);
        if (error) {
            if (isMissingTable(error)) return all;
            throw error;
        }
        const rows = Array.isArray(data) ? data : [];
        all.push(...rows);
        if (rows.length < pageSize) break;
    }
    return all;
}

async function listDbSessions(supabase) {
    const rows = await fetchAllPaged((from, to) => supabase
        .from('photo_sessions')
        .select('id, uuid, payment_method, amount, meta_data, status, created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false }) // tiebreaker -> total order, tránh trùng/sót ở ranh giới trang
        .range(from, to));

    return rows
        .map((session) => normalizeSessionTransaction(session, 'db-session'))
        .filter((session) => session.id);
}

async function listPaymentTransactions(supabase) {
    const rows = await fetchAllPaged((from, to) => supabase
        .from('payments')
        .select('*')
        .eq('status', 'paid')
        .order('paid_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false }) // tiebreaker -> total order, tránh trùng/sót ở ranh giới trang
        .range(from, to));

    return rows.map((payment) => {
        const payload = normalizeMeta(payment.raw_payload);
        return {
            id: payment.session_id || payment.id,
            code: payment.code,
            value: toNumber(payment.amount),
            status: payment.status,
            used_at: payment.paid_at || payment.created_at,
            created_at: payment.created_at,
            payment_method: 'qr',
            payment_code: null,
            sepay_order_code: payment.code,
            method_label: methodLabel('qr'),
            detail_label: detailLabel('qr', null, payment.code),
            source: 'payment',
            device_id: payload.device_id || null,
        };
    });
}

async function readRevenueResetAt(supabase) {
    const { data, error } = await supabase
        .from('app_configs')
        .select('config')
        .eq('key', 'app')
        .maybeSingle();

    if (error && isMissingTable(error)) return null;
    if (error) throw error;

    const value = data?.config?.revenue_reset_at;
    return value ? new Date(value).toISOString() : null;
}

async function writeRevenueResetAt(supabase) {
    const resetAt = new Date().toISOString();
    const { data, error } = await supabase
        .from('app_configs')
        .select('config')
        .eq('key', 'app')
        .maybeSingle();

    if (error && !isMissingTable(error)) throw error;

    const currentConfig = data?.config && typeof data.config === 'object' && !Array.isArray(data.config)
        ? data.config
        : {};

    const { error: writeError } = await supabase
        .from('app_configs')
        .upsert({
            key: 'app',
            config: {
                ...currentConfig,
                revenue_reset_at: resetAt,
            },
            updated_at: resetAt,
        }, { onConflict: 'key' });

    if (writeError && !isMissingTable(writeError)) throw writeError;
    return resetAt;
}

async function clearBoothReports(supabase) {
    // Reset doanh thu cũng xóa báo cáo cuối ngày của booth (giấy còn + tiền mặt),
    // để dòng "💵 Tiền mặt" trên thẻ booth không còn dữ liệu cũ sau khi reset.
    const { error } = await supabase
        .from('app_configs')
        .upsert({
            key: 'booth_reports',
            config: {},
            updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });

    if (error && !isMissingTable(error)) throw error;
}

async function readHiddenBooths(supabase) {
    const { data, error } = await supabase
        .from('app_configs')
        .select('config')
        .eq('key', 'app')
        .maybeSingle();

    if (error && isMissingTable(error)) return [];
    if (error) throw error;

    const list = data?.config?.hidden_booths;
    return Array.isArray(list) ? list.map(String) : [];
}

async function hideBooth(supabase, deviceId) {
    const { data, error } = await supabase
        .from('app_configs')
        .select('config')
        .eq('key', 'app')
        .maybeSingle();

    if (error && !isMissingTable(error)) throw error;

    const currentConfig = data?.config && typeof data.config === 'object' && !Array.isArray(data.config)
        ? data.config
        : {};
    const existing = Array.isArray(currentConfig.hidden_booths) ? currentConfig.hidden_booths.map(String) : [];
    if (!existing.includes(String(deviceId))) existing.push(String(deviceId));

    const { error: writeError } = await supabase
        .from('app_configs')
        .upsert({
            key: 'app',
            config: { ...currentConfig, hidden_booths: existing },
            updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });

    if (writeError && !isMissingTable(writeError)) throw writeError;
    return existing;
}

function mergeTransactions(payments, dbSessions, storageSessions) {
    const bySession = new Map();
    const bySepayCode = new Map(); // gộp session<->payment theo mã QR khi id lệch nhau
    const merged = [];

    [...storageSessions, ...dbSessions].forEach((tx) => {
        if (!tx?.id) return;
        const key = String(tx.id);
        bySession.set(key, tx);
        if (tx.sepay_order_code) bySepayCode.set(String(tx.sepay_order_code), key);
    });

    payments.forEach((payment) => {
        // Khớp trực tiếp theo id; nếu trượt thì khớp theo mã SePay (uuid session được tạo
        // muộn hơn session_id của order nên id thường lệch cho cùng một giao dịch).
        let sessionKey = payment.id && bySession.has(String(payment.id)) ? String(payment.id) : '';
        if (!sessionKey && payment.sepay_order_code && bySepayCode.has(String(payment.sepay_order_code))) {
            sessionKey = bySepayCode.get(String(payment.sepay_order_code));
        }
        const sessionTx = sessionKey ? bySession.get(sessionKey) : null;
        if (sessionTx) {
            const sepayCode = sessionTx.sepay_order_code || payment.sepay_order_code;
            bySession.set(sessionKey, {
                ...sessionTx,
                sepay_order_code: sepayCode,
                status: payment.status || sessionTx.status, // phản ánh đã thanh toán
                detail_label: detailLabel(sessionTx.payment_method, sessionTx.payment_code, sepayCode),
            });
            return;
        }

        merged.push(payment);
    });

    merged.push(...bySession.values());

    return merged.sort((a, b) => new Date(txDate(b)).getTime() - new Date(txDate(a)).getTime());
}

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const supabase = getSupabaseAdmin();

        if (req.method === 'POST') {
            if (req.body?.code !== '8686') return json(res, 403, { error: 'Invalid reset code' });

            const action = String(req.body?.action || '').trim();
            if (action === 'hide_booth') {
                const deviceId = String(req.body?.device_id || req.body?.deviceId || '').trim();
                if (!deviceId) return json(res, 400, { error: 'Missing device_id' });
                const hidden = await hideBooth(supabase, deviceId);
                return json(res, 200, { success: true, hidden_booths: hidden });
            }

            // Hard reset: xóa THẬT toàn bộ dữ liệu liên quan (mã thanh toán, session,
            // giao dịch QR, upload mobile, ảnh/motion trong storage). Không thể khôi phục.
            const deleted = await hardResetRevenueData(supabase);
            const resetAt = await writeRevenueResetAt(supabase);
            await clearBoothReports(supabase);
            return json(res, 200, { success: true, reset_at: resetAt, deleted });
        }

        if (req.method !== 'GET') return methodNotAllowed(res);

        const startDate = req.query?.startDate || '';
        const endDate = req.query?.endDate || '';
        const paymentMethod = req.query?.paymentMethod || '';

        const [payments, dbSessions, storageSessions, revenueResetAt, hiddenBooths] = await Promise.all([
            listPaymentTransactions(supabase),
            listDbSessions(supabase),
            listStorageSessions(supabase),
            readRevenueResetAt(supabase),
            readHiddenBooths(supabase),
        ]);

        const hiddenSet = new Set(hiddenBooths.map(String));
        const transactions = mergeTransactions(payments, dbSessions, storageSessions)
            .filter((tx) => !revenueResetAt || new Date(txDate(tx)).getTime() >= new Date(revenueResetAt).getTime())
            .filter((tx) => !hiddenSet.has(String(tx.device_id || '')))
            .filter((tx) => inRange(tx, startDate, endDate))
            .filter((tx) => matchesMethod(tx, paymentMethod));

        // Gắn TÊN nhân viên đã lấy mã cho các giao dịch trả bằng Mã thanh toán:
        //   payment_code -> payment_codes.claimed_by (username) -> staff_accounts.display_name.
        try {
            const codeStrings = [...new Set(transactions.map((t) => t.payment_code).filter(Boolean))];
            if (codeStrings.length) {
                const { data: codeRows } = await supabase
                    .from('payment_codes')
                    .select('code, claimed_by')
                    .in('code', codeStrings);
                const codeToUser = {};
                (codeRows || []).forEach((r) => { if (r.claimed_by) codeToUser[r.code] = r.claimed_by; });

                const usernames = [...new Set(Object.values(codeToUser))];
                const userToName = {};
                if (usernames.length) {
                    const { data: accs } = await supabase
                        .from('staff_accounts')
                        .select('username, display_name')
                        .in('username', usernames);
                    (accs || []).forEach((a) => { userToName[a.username] = a.display_name || a.username; });
                }

                transactions.forEach((t) => {
                    const u = t.payment_code ? codeToUser[t.payment_code] : null;
                    if (u) t.staff_name = userToName[u] || u;
                });
            }
        } catch (enrichError) {
            // Không có bảng staff_accounts / lỗi phụ -> bỏ qua, doanh thu vẫn trả bình thường.
            console.warn('Enrich staff_name failed:', enrichError?.message || enrichError);
        }

        const totalRevenue = transactions.reduce((sum, tx) => sum + toNumber(tx.value), 0);
        const paymentBreakdown = transactions.reduce((acc, tx) => {
            const key = tx.payment_method || 'unknown';
            acc[key] = (acc[key] || 0) + toNumber(tx.value);
            return acc;
        }, {});

        return json(res, 200, {
            totalRevenue,
            transactions,
            paymentBreakdown,
            chartData: [],
            revenueResetAt,
        });
    } catch (error) {
        console.error('Revenue API failed:', error);
        return json(res, 500, { error: error.message || 'Revenue API failed' });
    }
}
