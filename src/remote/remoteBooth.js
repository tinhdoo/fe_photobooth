// Phía BOOTH của điều khiển bằng điện thoại (xem kenhRemote.js). Một phiên cho cả lượt khách, sống ở cấp module:
// mở ở màn Chuẩn bị, bước Chụp / Chọn ảnh / … / Kết quả gửi trạng thái, trang tải lại sau mỗi lượt là hết.
import { useEffect, useState } from 'react';
import { supabase, isSupabaseBrowserConfigured } from '../services/supabaseClient';
import { CLOUD_API_URL } from '../config/api';
import { SK_BOOTH, SK_DT, NHIP_MS, MAT_SAU_MS, tenKenh, taoMa } from './kenhRemote';

let phien = null;
const ngheSuKien = new Set();   // (loai) => void : 'noi' | 'mat' | 'chup'
const ngheKetNoi = new Set();   // (ketNoi) => void

export const remoteDungDuoc = () => !!(isSupabaseBrowserConfigured && supabase);

const phat = (loai) => ngheSuKien.forEach((f) => { try { f(loai); } catch (e) { console.warn('[remote]', e); } });
const doiKetNoi = (k) => {
    if (!phien || phien.ketNoi === k) return;
    phien.ketNoi = k;
    ngheKetNoi.forEach((f) => f(k));
};

function gui() {
    if (!phien?.daVao) return;
    phien.seq += 1;
    phien.kenh.send({ type: 'broadcast', event: SK_BOOTH, payload: { ...phien.trangThai, chu: phien.chu, seq: phien.seq } })
        .catch(() => { /* mất mạng: nhịp sau gửi lại */ });
}

/** Mở phiên cho lượt này (gọi nhiều lần vẫn một phiên). null nếu máy không có Supabase. */
export function moRemote() {
    if (phien) return phien;
    if (!remoteDungDuoc()) return null;
    const ma = taoMa();
    const kenh = supabase.channel(tenKenh(ma), { config: { broadcast: { self: false, ack: false } } });
    phien = { ma, kenh, chu: null, lanCuoiDt: 0, ketNoi: 'chua', daVao: false, hong: false, choVao: [], seq: 0, trangThai: { buoc: 'chuan_bi' } };
    const p = phien;
    kenh.on('broadcast', { event: SK_DT }, ({ payload }) => {
        if (phien !== p || !payload?.id || typeof payload.id !== 'string') return;
        const { loai, id } = payload;
        if (!p.chu && loai === 'chao') {
            p.chu = id;
            p.lanCuoiDt = Date.now();
            doiKetNoi('on');
            phat('noi');
            gui();
            return;
        }
        if (id !== p.chu) {
            // Máy chủ đã mất (đóng trang / tắt màn hình quá MAT_SAU_MS) -> máy đang chào hoặc đang chờ được nhận thay,
            // không thì khách bị khoá ngoài suốt lượt. Không nhận 'chup' ở đây: nút chỉ hiện sau khi đã được nhận.
            if (p.ketNoi === 'lost' && loai !== 'chup') {
                p.chu = id;
                p.lanCuoiDt = Date.now();
                doiKetNoi('on');
                phat('noi');
                gui();
                return;
            }
            if (loai === 'chao') gui(); // máy thứ hai: trả trạng thái (chu khác id) -> nó tự báo "đã có người"
            return;
        }
        p.lanCuoiDt = Date.now();
        if (p.ketNoi !== 'on') { doiKetNoi('on'); phat('noi'); }
        if (loai === 'chao') gui();
        else if (loai === 'chup') phat('chup');
    });
    kenh.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            p.daVao = true;
            p.choVao.splice(0).forEach((f) => f(true));
            gui();
        } else if (!p.daVao && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
            p.hong = true;
            p.choVao.splice(0).forEach((f) => f(false));
        }
    });
    p.nhip = setInterval(() => {
        if (phien !== p) return;
        if (p.chu && p.ketNoi === 'on' && Date.now() - p.lanCuoiDt > MAT_SAU_MS) { doiKetNoi('lost'); phat('mat'); }
        gui();
    }, NHIP_MS);
    return p;
}

export const phienRemote = () => phien;

/** Chờ booth vào được kênh (true) — lỗi / quá ms thì false. Dùng để chỉ hiện QR khi kênh chạy thật. */
export function choVaoKenh(ms = 3000) {
    const p = phien;
    if (!p || p.hong) return Promise.resolve(false);
    if (p.daVao) return Promise.resolve(true);
    return new Promise((resolve) => {
        let xong = false;
        const ket = (ok) => { if (!xong) { xong = true; clearTimeout(t); resolve(ok); } };
        const t = setTimeout(() => ket(false), ms);
        p.choVao.push(ket);
    });
}
export const urlRemote = () => (phien ? `${CLOUD_API_URL || window.location.origin}/r/${phien.ma}` : null);
/** 'chua' (chưa có điện thoại) | 'on' | 'lost' — 'chua' cả khi chưa mở phiên. */
export const ketNoiRemote = () => phien?.ketNoi || 'chua';

/** Cập nhật trạng thái gửi cho điện thoại (gộp với trạng thái cũ) và gửi ngay; im = chỉ gộp, nhịp sau mới gửi
 *  (đồng hồ giây). Chưa mở phiên thì thôi. */
export function guiRemote(capNhat, { im = false } = {}) {
    if (!phien) return;
    phien.trangThai = { ...phien.trangThai, ...capNhat };
    if (!im) gui();
}

export function ngheRemote(fn) {
    ngheSuKien.add(fn);
    return () => ngheSuKien.delete(fn);
}

export function dongRemote() {
    if (!phien) return;
    clearInterval(phien.nhip);
    try { supabase.removeChannel(phien.kenh); } catch { /* bỏ qua */ }
    phien = null;
    ngheKetNoi.forEach((f) => f('chua'));
}

/** Trạng thái kết nối điện thoại cho component. */
export function useKetNoiRemote() {
    const [k, setK] = useState(ketNoiRemote);
    useEffect(() => {
        setK(ketNoiRemote());
        ngheKetNoi.add(setK);
        return () => { ngheKetNoi.delete(setK); };
    }, []);
    return k;
}
