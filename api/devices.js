import { getSupabaseAdmin, handleOptions, json } from '../lib/supabase.js';
import { requireActiveAdmin } from '../lib/auth.js';

// Tính năng bật RIÊNG từng máy (máy có máy không), lưu ở app_configs key='device_features' (JSON, không đổi
// schema) dạng { [device_id]: { id_photo: true } }. Nhịp tim trả về cho booth; admin bật/tắt ở trang Thiết bị.
//   id_photo: hiện lựa chọn "Ảnh thẻ" ở màn chọn chế độ. Mặc định TẮT (máy không có thì bỏ luôn màn chọn chế độ).
async function readFeatures(supabase) {
    const { data } = await supabase
        .from('app_configs').select('config').eq('key', 'device_features').maybeSingle();
    return (data?.config && typeof data.config === 'object' && !Array.isArray(data.config)) ? data.config : {};
}
const idPhotoOf = (features, deviceId) => features?.[deviceId]?.id_photo === true;

// Độ mượt từng máy: gộp meta_data.do_muot của các lượt N ngày gần nhất (booth >= 0.0.32, src/utils/doMuot.js).
// Độ trễ chạm gửi lên dạng biểu đồ tần suất theo ROI_TRE (phải khớp doMuot.js) -> cộng dồn chính xác giữa các lượt.
const ROI_TRE = [16, 32, 50, 75, 100, 150, 200, 300, 500, 1000, 2000];
const TOI_DA_MAU = 3000;

function phanViBieuDo(h, q, max) {
    const n = h.reduce((a, x) => a + x, 0);
    if (!n) return null;
    const can = Math.ceil(q * n);
    let tich = 0;
    for (let i = 0; i < h.length; i++) {
        tich += h[i];
        if (tich >= can) return i < ROI_TRE.length ? ROI_TRE[i] : Math.max(max || 0, 2001);
    }
    return null;
}
function tomTatSo(ds) {
    if (!ds.length) return null;
    const s = [...ds].sort((a, b) => a - b);
    const p = (q) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
    return { n: s.length, p50: p(0.5), p95: p(0.95), max: s[s.length - 1] };
}

async function tongHopDoMuot(supabase, ngayRaw) {
    const ngay = Math.min(30, Math.max(1, parseInt(ngayRaw, 10) || 7));
    const { data, error } = await supabase
        .from('photo_sessions')
        .select('created_at, may:meta_data->>device_id, dm:meta_data->do_muot')
        .gte('created_at', new Date(Date.now() - ngay * 86400000).toISOString())
        .not('meta_data->do_muot', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5000);
    if (error) throw error;

    const rong = () => new Array(ROI_TRE.length + 1).fill(0);
    const may = {};
    const lay = (id) => (may[id] ||= { luot: 0, luot_loi: 0, bo_do: 0, h: rong(), max: 0, buoc: {}, tg: {}, dem: {}, dung: 0, loi_gan: [] });
    const so = (x) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : null);
    const cong = (m, dm, luc) => {
        for (const [b, o] of Object.entries(dm.buoc || {})) {
            if (!o || typeof o !== 'object') continue;
            const mb = (m.buoc[b] ||= { h: rong(), max: 0, dung: 0 });
            if (Array.isArray(o.h)) {
                o.h.slice(0, ROI_TRE.length + 1).forEach((x, i) => { const v = so(x) || 0; m.h[i] += v; mb.h[i] += v; });
            }
            const mx = so(o.max) || 0;
            mb.max = Math.max(mb.max, mx);
            m.max = Math.max(m.max, mx);
            const d = so(o.dung) || 0;
            mb.dung += d;
            m.dung += d;
        }
        const tg = { ...(dm.tg || {}) };
        if (dm.them && typeof dm.them === 'object') {
            if (so(dm.them.luu_ms) != null) tg.luu = [dm.them.luu_ms];
            if (so(dm.them.tai_nen_ms) != null) tg.tai_nen = [dm.them.tai_nen_ms];
        }
        for (const [ten, ds] of Object.entries(tg)) {
            if (!Array.isArray(ds)) continue;
            const dich = (m.tg[ten] ||= []);
            for (const x of ds) if (so(x) != null && dich.length < TOI_DA_MAU) dich.push(Number(x));
        }
        for (const [ten, x] of Object.entries(dm.dem || {})) {
            if (so(x) != null) m.dem[ten] = (m.dem[ten] || 0) + Number(x);
        }
        for (const l of Array.isArray(dm.loi) ? dm.loi : []) {
            m.loi_gan.push({ luc, b: String(l?.b || ''), m: String(l?.m || ''), t: String(l?.t || '').slice(0, 120) });
        }
    };

    for (const row of data || []) {
        const dm = row.dm;
        if (!dm || typeof dm !== 'object') continue;
        const m = lay(row.may || '?');
        m.luot += 1;
        if (Array.isArray(dm.loi) && dm.loi.length) m.luot_loi += 1;
        cong(m, dm, row.created_at);
        // Lượt hỏng / bỏ dở trước đó (không lên cloud được) gửi kèm lượt này.
        for (const t of Array.isArray(dm.truoc) ? dm.truoc : []) {
            if (!t || typeof t !== 'object') continue;
            if (!t.sau_luu) m.bo_do += 1;
            cong(m, t, t.luc || row.created_at);
        }
    }

    const ra = {};
    for (const [id, m] of Object.entries(may)) {
        const buoc = {};
        for (const [b, o] of Object.entries(m.buoc)) {
            const n = o.h.reduce((a, x) => a + x, 0);
            buoc[b] = { n, p95: phanViBieuDo(o.h, 0.95, o.max), max: o.max, dung: o.dung };
        }
        const tg = {};
        for (const [ten, ds] of Object.entries(m.tg)) tg[ten] = tomTatSo(ds);
        ra[id] = {
            luot: m.luot,
            luot_loi: m.luot_loi,
            bo_do: m.bo_do,
            cham: { n: m.h.reduce((a, x) => a + x, 0), p50: phanViBieuDo(m.h, 0.5, m.max), p95: phanViBieuDo(m.h, 0.95, m.max), max: m.max },
            dung: m.dung,
            buoc,
            tg,
            dem: m.dem,
            loi_gan: m.loi_gan.sort((a, b) => String(b.luc).localeCompare(String(a.luc))).slice(0, 20),
        };
    }
    return { ngay, may: ra };
}

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
            let features = {};
            try { features = await readFeatures(supabase); } catch (fErr) { console.warn('device_features read failed:', fErr?.message || fErr); }
            return json(res, 200, {
                ...data,
                id_photo: idPhotoOf(features, deviceId),
                mode: data.mode || 'payment',
                name: data.name || `Máy ${deviceId.slice(-6).toUpperCase()}`,
            });
        }

        if (req.method === 'PUT') {
            // Đổi tên / chế độ booth: CHỈ admin. Chế độ 'event' = khách bỏ qua thanh toán, nên trước đây để
            // mở (cho nút gạt trên kiosk, gửi không token) là ai biết id cũng bật được chụp miễn phí.
            // Từ 2026-10-03 đổi chế độ ở trang Cài đặt trên cloud; nút gạt trên booth (<= 0.0.19) bị
            // từ chối và nhịp tim kéo booth về chế độ trên cloud trong <= 60 s.
            if (!(await requireActiveAdmin(req, res, supabase))) return undefined;

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
            const idPhoto = req.body?.id_photo;
            if (idPhoto !== undefined && typeof idPhoto !== 'boolean') {
                return json(res, 400, { error: 'Invalid id_photo' });
            }

            if (hasName) updates.name = req.body.name.trim();
            if (typeof mode === 'string') updates.mode = mode;

            const { data, error } = await supabase
                .from('devices')
                .update(updates)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;

            let features = null;
            if (typeof idPhoto === 'boolean') {
                features = await readFeatures(supabase);
                features[data.device_id] = { ...(features[data.device_id] || {}), id_photo: idPhoto };
                const { error: fErr } = await supabase.from('app_configs').upsert(
                    { key: 'device_features', config: features, updated_at: new Date().toISOString() },
                    { onConflict: 'key' }
                );
                if (fErr) throw fErr;
            } else {
                try { features = await readFeatures(supabase); } catch { features = {}; }
            }
            return json(res, 200, { ...data, id_photo: idPhotoOf(features, data.device_id) });
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

        if (String(req.query?.resource || '') === 'do-muot') {
            return json(res, 200, await tongHopDoMuot(supabase, req.query?.ngay));
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
        // Đính kèm các MÁY (hostname) đã từng gửi nhịp tim với device_id đó
        const { data: mRow } = await supabase
            .from('app_configs').select('config').eq('key', 'booth_machines').maybeSingle();
        const machinesAll = (mRow?.config && typeof mRow.config === 'object' && !Array.isArray(mRow.config))
            ? mRow.config : {};
        let features = {};
        try { features = await readFeatures(supabase); } catch (fErr) { console.warn('device_features read failed:', fErr?.message || fErr); }
        const list = (Array.isArray(data) ? data : []).map((d) => ({
            ...d,
            id_photo: idPhotoOf(features, d.device_id),
            report: reports[d.device_id] || null,
            machines: machinesAll[d.device_id] || null,
        }));

        return json(res, 200, list);
    } catch (error) {
        console.error('Devices API failed:', error);
        return json(res, 500, { error: error.message || 'Devices API failed' });
    }
}
