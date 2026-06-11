import { getSupabaseAdmin, json, methodNotAllowed } from '../_supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res);

    try {
        const code = String(req.body?.code || '').trim().toUpperCase();
        if (!code) {
            return json(res, 400, { valid: false, message: 'Vui lòng nhập mã thanh toán.' });
        }

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('payment_codes')
            .select('*')
            .eq('code', code)
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            return json(res, 404, { valid: false, message: 'Mã thanh toán không tồn tại.' });
        }
        if (data.is_used) {
            return json(res, 400, { valid: false, message: 'Mã thanh toán đã được sử dụng.' });
        }
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
    } catch (error) {
        console.error('Validate payment code failed:', error);
        return json(res, 500, { valid: false, message: error.message || 'Không thể kiểm tra mã thanh toán.' });
    }
}
