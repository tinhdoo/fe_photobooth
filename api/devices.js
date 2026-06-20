import { getSupabaseAdmin, handleOptions, json } from '../lib/supabase.js';

export default async function handler(req, res) {
    if (handleOptions(req, res)) return;

    try {
        const supabase = getSupabaseAdmin();

        if (req.method === 'POST') {
            const action = String(req.body?.action || req.query?.action || '').trim();

            // Booth gửi báo cáo cuối ngày (giấy còn + tiền mặt) lúc khởi động.
            // Lưu vào app_configs key='booth_reports' (JSON) -> không cần đổi schema.
            if (action === 'report') {
                const deviceId = String(req.body?.device_id || req.body?.deviceId || '').trim();
                if (!deviceId) return json(res, 400, { error: 'Missing device_id' });

                const { data: cfgRow } = await supabase
                    .from('app_configs').select('config').eq('key', 'booth_reports').maybeSingle();
                const reports = (cfgRow?.config && typeof cfgRow.config === 'object' && !Array.isArray(cfgRow.config))
                    ? cfgRow.config : {};

                reports[deviceId] = {
                    paper_remaining: (req.body?.paper_remaining ?? null),
                    cash_total: Number(req.body?.cash_total || 0),
                    cash_count: Number(req.body?.cash_count || 0),
                    business_date: req.body?.business_date || null,
                    reported_at: new Date().toISOString(),
                };

                await supabase.from('app_configs').upsert(
                    { key: 'booth_reports', config: reports, updated_at: new Date().toISOString() },
                    { onConflict: 'key' }
                );
                return json(res, 200, { success: true });
            }

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

        // Đính kèm báo cáo giấy + tiền mặt (nếu có) cho từng booth
        const { data: cfgRow } = await supabase
            .from('app_configs').select('config').eq('key', 'booth_reports').maybeSingle();
        const reports = (cfgRow?.config && typeof cfgRow.config === 'object' && !Array.isArray(cfgRow.config))
            ? cfgRow.config : {};
        const list = (Array.isArray(data) ? data : []).map((d) => ({ ...d, report: reports[d.device_id] || null }));

        return json(res, 200, list);
    } catch (error) {
        console.error('Devices API failed:', error);
        return json(res, 500, { error: error.message || 'Devices API failed' });
    }
}
