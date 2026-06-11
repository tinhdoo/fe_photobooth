import { getSupabaseAdmin, json, methodNotAllowed } from '../../_supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res);

    try {
        const { id } = req.query;
        if (!id) {
            return json(res, 400, { success: false, message: 'Thiếu ID mã thanh toán.' });
        }

        const supabase = getSupabaseAdmin();
        const { data: current, error: fetchError } = await supabase
            .from('payment_codes')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!current) {
            return json(res, 404, { success: false, message: 'Mã thanh toán không tồn tại.' });
        }
        if (current.is_used) {
            return json(res, 400, { success: false, message: 'Mã thanh toán đã được sử dụng.' });
        }
        if (current.expires_at && new Date(current.expires_at).getTime() < Date.now()) {
            return json(res, 400, { success: false, message: 'Mã thanh toán đã hết hạn.' });
        }

        const { data, error } = await supabase
            .from('payment_codes')
            .update({
                is_used: true,
                used_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('is_used', false)
            .select()
            .single();

        if (error) throw error;

        return json(res, 200, { success: true, code: data });
    } catch (error) {
        console.error('Use payment code failed:', error);
        return json(res, 500, { success: false, message: error.message || 'Không thể sử dụng mã thanh toán.' });
    }
}
