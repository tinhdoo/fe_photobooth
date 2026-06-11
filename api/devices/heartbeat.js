import { getSupabaseAdmin, handleOptions, json, methodNotAllowed } from '../_supabase.js';

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res);

    try {
        const deviceId = String(req.body?.deviceId || req.body?.device_id || '').trim();
        const name = String(req.body?.name || '').trim();

        if (!deviceId) {
            return json(res, 400, { error: 'Missing deviceId' });
        }

        const supabase = getSupabaseAdmin();
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
    } catch (error) {
        console.error('Device heartbeat failed:', error);
        return json(res, 500, { error: error.message || 'Device heartbeat failed' });
    }
}
