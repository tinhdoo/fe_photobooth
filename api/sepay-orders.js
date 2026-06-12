import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from '../lib/supabase.js';

function randomCode() {
    const alphabet = '0123456789';
    let code = process.env.SEPAY_PAYMENT_PREFIX || 'TOMA';
    for (let i = 0; i < 8; i += 1) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
}

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res);

    try {
        const amount = Number(req.body?.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
            return json(res, 400, { error: 'Invalid amount' });
        }

        const supabase = getSupabaseAdmin();
        const bank = process.env.SEPAY_BANK || 'BIDV';
        const accountNumber = process.env.SEPAY_ACCOUNT_NUMBER || '96247LZ0ZM';
        const template = process.env.SEPAY_TEMPLATE || 'compact';
        const sessionId = req.body?.session_id || null;
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        let payment = null;
        let lastError = null;

        for (let attempt = 0; attempt < 5; attempt += 1) {
            const code = randomCode();
            const { data, error } = await supabase
                .from('payments')
                .insert({
                    session_id: sessionId,
                    code,
                    amount,
                    status: 'pending',
                    provider: 'sepay',
                    bank,
                    account_number: accountNumber,
                    expires_at: expiresAt,
                })
                .select()
                .single();

            if (!error) {
                payment = data;
                break;
            }
            lastError = error;
            if (error.code !== '23505') break;
        }

        if (!payment) {
            throw lastError || new Error('Cannot create payment');
        }

        const qrUrl = `https://qr.sepay.vn/img?${new URLSearchParams({
            bank,
            acc: accountNumber,
            amount: String(amount),
            des: payment.code,
            template,
        }).toString()}`;

        return json(res, 201, {
            id: payment.id,
            code: payment.code,
            amount: payment.amount,
            status: payment.status,
            bank,
            account_number: accountNumber,
            content: payment.code,
            qr_url: qrUrl,
            expires_at: payment.expires_at,
        });
    } catch (error) {
        console.error('Create Sepay order failed:', error);
        return json(res, 500, { error: error.message || 'Create Sepay order failed' });
    }
}
