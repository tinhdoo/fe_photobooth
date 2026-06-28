import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from '../lib/supabase.js';

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

async function insertOneCode(supabase, value, expiresAt) {
    let lastError = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = randomPaymentCode();
        const { data, error } = await supabase
            .from('payment_codes')
            .insert({ code, value, expires_at: expiresAt, is_used: false })
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
            created.push(await insertOneCode(supabase, batch.value, expiresAt));
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
        .update({ is_used: true, used_at: new Date().toISOString() })
        .eq('id', id)
        .eq('is_used', false)
        .select()
        .single();

    if (error) throw error;
    return json(res, 200, { success: true, code: data });
}

async function cleanupPaymentCodes(req, res, supabase) {
    const secret = process.env.CLEANUP_SECRET;
    const auth = String(req.headers.authorization || '');
    if (secret && auth !== `Bearer ${secret}` && req.query.secret !== secret) {
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

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const supabase = getSupabaseAdmin();

        if (req.method === 'POST') {
            const action = String(req.body?.action || req.query?.action || '').trim();
            if (action === 'generate') return generateCodes(req, res, supabase);
            if (action === 'validate') return validateCode(req, res, supabase);
            if (action === 'use') return markCodeUsed(req, res, supabase);
            if (action === 'cleanup') return cleanupPaymentCodes(req, res, supabase);
            return json(res, 400, { error: 'Invalid action' });
        }

        if (req.method !== 'GET') return methodNotAllowed(res);

        if (String(req.query?.action || '').trim() === 'cleanup') {
            return cleanupPaymentCodes(req, res, supabase);
        }

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
