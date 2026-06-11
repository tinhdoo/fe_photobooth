import { getSupabaseAdmin, json, methodNotAllowed } from '../_supabase.js';

function randomPaymentCode() {
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i += 1) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res);

    try {
        const value = Number(req.body?.value || 0);
        const quantity = Math.min(Math.max(Number(req.body?.quantity || 1), 1), 100);
        const expiresAt = req.body?.expires_at || null;

        if (!Number.isFinite(value) || value <= 0) {
            return json(res, 400, { error: 'Invalid code value' });
        }

        const supabase = getSupabaseAdmin();
        const created = [];

        for (let i = 0; i < quantity; i += 1) {
            let inserted = null;
            let lastError = null;

            for (let attempt = 0; attempt < 10; attempt += 1) {
                const code = randomPaymentCode();
                const { data, error } = await supabase
                    .from('payment_codes')
                    .insert({
                        code,
                        value,
                        expires_at: expiresAt,
                        is_used: false,
                    })
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
    } catch (error) {
        console.error('Generate payment codes failed:', error);
        return json(res, 500, { error: error.message || 'Generate payment codes failed' });
    }
}
