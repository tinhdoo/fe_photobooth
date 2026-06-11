import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from './_supabase.js';

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
            const meta = session.meta_data || {};
            const paymentMethod = session.payment_method || 'cash';
            const paymentCode = meta.payment_code || session.payment_code || null;
            const sepayCode = meta.sepay_order_code || session.sepay_order_code || null;
            return {
                id: session.uuid || file.name.replace(/\.json$/, ''),
                code: paymentCode || sepayCode || paymentMethod,
                value: toNumber(session.amount),
                status: session.status || 'active',
                used_at: session.created_at || file.created_at || file.updated_at,
                created_at: session.created_at || file.created_at || file.updated_at,
                payment_method: paymentMethod,
                payment_code: paymentCode,
                sepay_order_code: sepayCode,
                method_label: methodLabel(paymentMethod),
                detail_label: detailLabel(paymentMethod, paymentCode, sepayCode),
                source: 'session',
            };
        } catch {
            return null;
        }
    }));

    return rows.filter(Boolean);
}

async function listPaymentTransactions(supabase) {
    const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'paid')
        .order('paid_at', { ascending: false, nullsFirst: false });

    if (error && isMissingTable(error)) return [];
    if (error) throw error;

    return (Array.isArray(data) ? data : []).map((payment) => ({
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
    }));
}

function mergeTransactions(payments, sessions) {
    const seen = new Set();
    const merged = [];

    [...payments, ...sessions].forEach((tx) => {
        const key = tx.source === 'payment' ? `payment:${tx.code}` : `session:${tx.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(tx);
    });

    return merged.sort((a, b) => new Date(txDate(b)).getTime() - new Date(txDate(a)).getTime());
}

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const supabase = getSupabaseAdmin();

        if (req.method === 'POST') {
            if (req.body?.code !== '8686') return json(res, 403, { error: 'Invalid reset code' });

            await supabase.from('payments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
            return json(res, 200, { success: true });
        }

        if (req.method !== 'GET') return methodNotAllowed(res);

        const startDate = req.query?.startDate || '';
        const endDate = req.query?.endDate || '';
        const paymentMethod = req.query?.paymentMethod || '';

        const [payments, sessions] = await Promise.all([
            listPaymentTransactions(supabase),
            listStorageSessions(supabase),
        ]);

        const transactions = mergeTransactions(payments, sessions)
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
        });
    } catch (error) {
        console.error('Revenue API failed:', error);
        return json(res, 500, { error: error.message || 'Revenue API failed' });
    }
}
