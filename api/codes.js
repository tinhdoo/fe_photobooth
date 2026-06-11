import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from './_supabase.js';

function randomPaymentCode() {
    const alphabet = '0123456789';
    let code = '';
    for (let i = 0; i < 6; i += 1) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
}

async function generateCodes(req, res, supabase) {
    const value = Number(req.body?.value || 0);
    const quantity = Math.min(Math.max(Number(req.body?.quantity || 1), 1), 100);
    const expiresAt = req.body?.expires_at || null;

    if (!Number.isFinite(value) || value <= 0) {
        return json(res, 400, { error: 'Invalid code value' });
    }

    const created = [];
    for (let i = 0; i < quantity; i += 1) {
        let inserted = null;
        let lastError = null;

        for (let attempt = 0; attempt < 10; attempt += 1) {
            const code = randomPaymentCode();
            const { data, error } = await supabase
                .from('payment_codes')
                .insert({ code, value, expires_at: expiresAt, is_used: false })
                .select()
                .single();

            if (!error) {
                inserted = data;
                break;
            }

            lastError = error;
            if (error.code !== '23505') break;
        }

        if (!inserted) throw lastError || new Error('Cannot create payment code');
        created.push(inserted);
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

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const supabase = getSupabaseAdmin();

        if (req.method === 'POST') {
            const action = String(req.body?.action || req.query?.action || '').trim();
            if (action === 'generate') return generateCodes(req, res, supabase);
            if (action === 'validate') return validateCode(req, res, supabase);
            if (action === 'use') return markCodeUsed(req, res, supabase);
            return json(res, 400, { error: 'Invalid action' });
        }

        if (req.method !== 'GET') return methodNotAllowed(res);

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
