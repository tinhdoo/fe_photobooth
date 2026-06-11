import { getSupabaseAdmin, handleOptions, json } from './_supabase.js';

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, { error: 'Method not allowed' });
    }

    try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('devices')
            .select('*')
            .order('last_active', { ascending: false, nullsFirst: false });

        if (error) throw error;

        return json(res, 200, Array.isArray(data) ? data : []);
    } catch (error) {
        console.error('Fetch devices failed:', error);
        return json(res, 500, { error: error.message || 'Fetch devices failed' });
    }
}
