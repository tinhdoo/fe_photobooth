import { getSupabaseAdmin, json } from './_supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, { error: 'Method not allowed' });
    }

    try {
        const supabase = getSupabaseAdmin();
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
