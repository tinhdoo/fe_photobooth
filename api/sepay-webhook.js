import { getSupabaseAdmin, json, methodNotAllowed } from './_supabase.js';

function getAuthToken(req) {
    const header = req.headers.authorization || req.headers.Authorization || '';
    const explicitHeader = req.headers['x-api-key'] || req.headers['sepay-api-key'];
    return String(explicitHeader || header)
        .replace(/^Apikey\s+/i, '')
        .replace(/^Bearer\s+/i, '')
        .trim();
}

function extractTransferCode(payload) {
    const prefix = process.env.SEPAY_PAYMENT_PREFIX || 'TOMA';
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const codePattern = new RegExp(`${escapedPrefix}[A-Z0-9]{7}`, 'i');
    const candidates = [
        payload?.code,
        payload?.payment_code,
        payload?.orderCode,
        payload?.content,
        payload?.description,
        payload?.transferContent,
        payload?.transactionContent,
    ].filter(Boolean).map(String);

    for (const value of candidates) {
        const match = value.match(codePattern);
        if (match) return match[0].toUpperCase();
    }

    return null;
}

function extractAmount(payload) {
    return Number(
        payload?.transferAmount
        || payload?.amount
        || payload?.money
        || payload?.creditAmount
        || 0
    );
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res);

    try {
        const expectedKey = process.env.SEPAY_API_KEY;
        if (expectedKey) {
            const provided = getAuthToken(req) || req.query?.key || req.body?.api_key;
            if (provided !== expectedKey) {
                return json(res, 401, { success: false, message: 'Unauthorized' });
            }
        }

        const payload = req.body || {};
        const code = extractTransferCode(payload);
        if (!code) {
            return json(res, 200, { success: true, message: 'No payment code found' });
        }

        const transferAmount = extractAmount(payload);
        const supabase = getSupabaseAdmin();

        const { data: payment, error: findError } = await supabase
            .from('payments')
            .select('*')
            .eq('code', code)
            .single();

        if (findError || !payment) {
            return json(res, 200, { success: true, message: 'Payment not found', code });
        }

        if (payment.status === 'paid') {
            return json(res, 200, { success: true, message: 'Already paid', code });
        }

        if (transferAmount > 0 && transferAmount < Number(payment.amount || 0)) {
            return json(res, 200, {
                success: true,
                message: 'Transfer amount is lower than payment amount',
                code,
            });
        }

        const transactionReference = payload?.referenceCode
            || payload?.transactionId
            || payload?.id
            || payload?.gatewayTransactionId
            || null;

        const { error: updateError } = await supabase
            .from('payments')
            .update({
                status: 'paid',
                paid_at: new Date().toISOString(),
                transaction_reference: transactionReference,
                raw_payload: payload,
            })
            .eq('id', payment.id);

        if (updateError) throw updateError;

        return json(res, 200, { success: true, message: 'Payment marked paid', code });
    } catch (error) {
        console.error('Sepay webhook failed:', error);
        return json(res, 500, { success: false, message: error.message || 'Webhook failed' });
    }
}
