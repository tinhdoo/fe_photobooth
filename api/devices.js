import { getSupabaseAdmin, handleOptions, json } from '../lib/supabase.js';

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const supabase = getSupabaseAdmin();

        if (req.method === 'POST') {
            const action = String(req.body?.action || req.query?.action || '').trim();
            if (action !== 'heartbeat') {
                return json(res, 400, { error: 'Invalid action' });
            }

            const deviceId = String(req.body?.deviceId || req.body?.device_id || '').trim();
            const name = String(req.body?.name || '').trim();

            if (!deviceId) return json(res, 400, { error: 'Missing deviceId' });

            const now = new Date().toISOString();
            const payload = {
                device_id: deviceId,
                last_active: now,
                updated_at: now,
            };

            if (name) payload.name = name;

            const { data, error } = await supabase
                .from('devices')
                .upsert(payload, { onConflict: 'device_id' })
                .select()
                .single();

            if (error) throw error;
            return json(res, 200, {
                ...data,
                mode: data.mode || 'payment',
                name: data.name || `Máy ${deviceId.slice(-6).toUpperCase()}`,
            });
        }

        if (req.method === 'PUT') {
            const id = req.body?.id || req.query?.id;
            if (!id) return json(res, 400, { error: 'Missing device id' });

            const updates = {
                updated_at: new Date().toISOString(),
            };

            if (typeof req.body?.name === 'string') updates.name = req.body.name.trim();
            if (typeof req.body?.mode === 'string') updates.mode = req.body.mode;

            const { data, error } = await supabase
                .from('devices')
                .update(updates)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;
            return json(res, 200, data);
        }

        if (req.method === 'DELETE') {
            const id = req.body?.id || req.query?.id;
            if (!id) return json(res, 400, { error: 'Missing device id' });

            const { error } = await supabase
                .from('devices')
                .delete()
                .eq('id', id);

            if (error) throw error;
            return json(res, 200, { success: true });
        }

        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET,POST,PUT,DELETE');
            return json(res, 405, { error: 'Method not allowed' });
        }

        const { data, error } = await supabase
            .from('devices')
            .select('*')
            .order('last_active', { ascending: false, nullsFirst: false });

        if (error) throw error;

        return json(res, 200, Array.isArray(data) ? data : []);
    } catch (error) {
        console.error('Devices API failed:', error);
        return json(res, 500, { error: error.message || 'Devices API failed' });
    }
}
