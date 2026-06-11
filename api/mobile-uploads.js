import { getSupabaseAdmin, handleOptions, json } from './_supabase.js';

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return json(res, 405, { error: 'Method not allowed' });
    }

    try {
        const sessionId = String(req.query?.session_id || '').trim();
        if (!sessionId) {
            return json(res, 400, { error: 'Missing session_id' });
        }

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
            .from('mobile_uploads')
            .select('*')
            .eq('session_uuid', sessionId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        return json(res, 200, Array.isArray(data) ? data : []);
    } catch (error) {
        console.error('Fetch mobile uploads failed:', error);
        return json(res, 500, { error: error.message || 'Fetch mobile uploads failed' });
    }
}
