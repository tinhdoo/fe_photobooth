import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from './_supabase.js';

function normalizeSession(row) {
    if (!row) return null;

    const expired = row.expires_at && new Date(row.expires_at).getTime() < Date.now();
    return {
        id: row.id,
        uuid: row.uuid,
        layout_id: row.layout_id,
        composite_url: row.composite_url,
        composite_public_id: row.composite_public_id,
        photos: Array.isArray(row.photos) ? row.photos : [],
        payment_method: row.payment_method,
        amount: row.amount,
        meta_data: row.meta_data || {},
        status: expired ? 'expired' : (row.status || 'active'),
        created_at: row.created_at,
        expires_at: row.expires_at,
    };
}

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const supabase = getSupabaseAdmin();

        if (req.method === 'GET') {
            const sessionId = String(req.query.id || req.query.uuid || '').trim();

            if (sessionId) {
                const { data, error } = await supabase
                    .from('photo_sessions')
                    .select('*')
                    .eq('uuid', sessionId)
                    .maybeSingle();

                if (error) throw error;
                if (!data) return json(res, 404, { error: 'Session not found' });
                return json(res, 200, normalizeSession(data));
            }

            const { data, error } = await supabase
                .from('photo_sessions')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) throw error;
            return json(res, 200, (data || []).map(normalizeSession));
        }

        if (req.method === 'POST') {
            const body = req.body || {};
            const uuid = String(body.session_id || body.uuid || '').trim();
            if (!uuid) return json(res, 400, { error: 'Missing session_id' });

            const { data, error } = await supabase
                .from('photo_sessions')
                .upsert({
                    uuid,
                    layout_id: body.layout_id || 'strip_4',
                    composite_url: body.composite_url || null,
                    composite_public_id: body.composite_public_id || null,
                    photos: Array.isArray(body.photos) ? body.photos : [],
                    payment_method: body.payment_method || 'cash',
                    amount: Number(body.amount || 0),
                    meta_data: body.meta_data || {},
                    status: 'active',
                    expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
                }, {
                    onConflict: 'uuid',
                })
                .select()
                .single();

            if (error) throw error;
            return json(res, 201, normalizeSession(data));
        }

        return methodNotAllowed(res);
    } catch (error) {
        console.error('Sessions API failed:', error);
        return json(res, 500, { error: error.message || 'Sessions API failed' });
    }
}
