import { getSupabaseAdmin, handleOptions, json } from '../lib/supabase.js';
import { requireActiveAdmin } from '../lib/auth.js';

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

            // Ghi nhớ MÁY nào (hostname) đã gửi nhịp tim với device_id này, chạy từ thư mục nào, bản nào.
            // Lưu ở app_configs key='booth_machines' (JSON, không đổi schema) dạng
            //   { [device_id]: { [hostname]: { install_dir, version, first_seen, last_seen } } }
            // Chỉ ghi khi có gì thay đổi ngoài last_seen quá 10 phút -> gần như chỉ 1 lần/lần khởi động.
            // Một device_id mà có >= 2 hostname = hai máy cùng mã -> Doanh thu cảnh báo đỏ.
            const machine = req.body?.machine;
            if (machine && typeof machine === 'object' && String(machine.hostname || '').trim()) {
                try {
                    const host = String(machine.hostname).trim().slice(0, 80);
                    const installDir = String(machine.install_dir || '').slice(0, 260);
                    const version = String(machine.version || '').slice(0, 40);
                    const { data: mRow } = await supabase
                        .from('app_configs').select('config').eq('key', 'booth_machines').maybeSingle();
                    const all = (mRow?.config && typeof mRow.config === 'object' && !Array.isArray(mRow.config))
                        ? mRow.config : {};
                    const perDevice = (all[deviceId] && typeof all[deviceId] === 'object') ? all[deviceId] : {};
                    const prev = perDevice[host] || null;
                    const stale = !prev || (Date.now() - new Date(prev.last_seen || 0).getTime()) > 10 * 60 * 1000;
                    if (!prev || prev.install_dir !== installDir || prev.version !== version || stale) {
                        perDevice[host] = {
                            install_dir: installDir,
                            version,
                            first_seen: prev?.first_seen || now,
                            last_seen: now,
                        };
                        all[deviceId] = perDevice;
                        await supabase.from('app_configs').upsert(
                            { key: 'booth_machines', config: all, updated_at: now },
                            { onConflict: 'key' }
                        );
                    }
                } catch (mErr) {
                    console.warn('booth_machines update failed:', mErr?.message || mErr);
                }
            }
            const payload = {
                device_id: deviceId,
                last_active: now,
                updated_at: now,
            };

            // Tên chỉ đặt khi ĐĂNG KÝ LẦN ĐẦU (row chưa có tên). KHÔNG cho heartbeat ghi đè tên đã
            // đặt từ dashboard: booth gửi heartbeat 60s/lần kèm tên mặc định "Máy Chụp 1", nếu đè
            // thì tên vừa đổi ở dashboard sẽ bị kéo về "Máy Chụp 1" sau ≤60s. Dashboard (PUT) là nguồn
            // đặt tên duy nhất có thẩm quyền.
            if (name) {
                const { data: existing } = await supabase
                    .from('devices')
                    .select('name')
                    .eq('device_id', deviceId)
                    .maybeSingle();
                if (!existing || !existing.name) payload.name = name;
            }

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

            const hasName = typeof req.body?.name === 'string';
            const mode = req.body?.mode;
            if (mode !== undefined && mode !== 'event' && mode !== 'payment') {
                return json(res, 400, { error: 'Invalid mode' });
            }
            // Đổi TÊN booth: chỉ admin. Đổi CHẾ ĐỘ (event/payment) vẫn mở: nút gạt trên kiosk ở booth
            // (bản 0.0.19 trở về trước) gửi PUT này không có token, chặn thì chế độ bị nhịp tim kéo về.
            if (hasName && !(await requireActiveAdmin(req, res, supabase))) return undefined;

            if (hasName) updates.name = req.body.name.trim();
            if (typeof mode === 'string') updates.mode = mode;

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
            if (!(await requireActiveAdmin(req, res, supabase))) return undefined;
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

        // Danh sách booth (kèm báo cáo tiền mặt, tên máy, thư mục cài) chỉ cho admin.
        if (!(await requireActiveAdmin(req, res, supabase))) return undefined;

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
        // Đính kèm các MÁY (hostname) đã từng gửi nhịp tim với device_id đó
        const { data: mRow } = await supabase
            .from('app_configs').select('config').eq('key', 'booth_machines').maybeSingle();
        const machinesAll = (mRow?.config && typeof mRow.config === 'object' && !Array.isArray(mRow.config))
            ? mRow.config : {};
        const list = (Array.isArray(data) ? data : []).map((d) => ({
            ...d,
            report: reports[d.device_id] || null,
            machines: machinesAll[d.device_id] || null,
        }));

        return json(res, 200, list);
    } catch (error) {
        console.error('Devices API failed:', error);
        return json(res, 500, { error: error.message || 'Devices API failed' });
    }
}
