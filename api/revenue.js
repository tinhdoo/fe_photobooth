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

async function listStorageSessions(supabase) {
    const bucket = await resolveBucket(supabase);
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

async function listDbSessions(supabase) {
    const { data, error } = await supabase
        .from('photo_sessions')
        .select('id, uuid, payment_method, amount, meta_data, status, created_at')
        .order('created_at', { ascending: false })
        .limit(1000);

    if (error && isMissingTable(error)) return [];
    if (error) throw error;

    return (Array.isArray(data) ? data : [])
        .map((session) => normalizeSessionTransaction(session, 'db-session'))
        .filter((session) => session.id);
}

async function listPaymentTransactions(supabase) {
    const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'paid')
        .order('paid_at', { ascending: false, nullsFirst: false });

    if (error && isMissingTable(error)) return [];
    if (error) throw error;

    return (Array.isArray(data) ? data : []).map((payment) => {
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

            const resetAt = await writeRevenueResetAt(supabase);
            await clearBoothReports(supabase);
            return json(res, 200, { success: true, reset_at: resetAt });
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
