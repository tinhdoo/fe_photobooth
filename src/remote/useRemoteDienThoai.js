// Phía ĐIỆN THOẠI của điều khiển máy ảnh (xem kenhRemote.js). Trả trạng thái để vẽ RemoteDienThoai + hàm chup().
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseBrowserConfigured } from '../services/supabaseClient';
import { SK_BOOTH, SK_DT, NHIP_MS, MAT_SAU_MS, tenKenh, maHopLe } from './kenhRemote';

const KHONG_THAY_BOOTH_MS = 9000;  // vào kênh mà không nghe booth -> mã cũ / booth đã xong lượt
const HET_HAN_MS = 60000;          // mất booth lâu vậy -> coi như lượt đã hết

// Mã điện thoại giữ qua lần tải lại trang (khách lỡ kéo làm mới vẫn là "chủ").
function maDienThoai() {
    try {
        let id = sessionStorage.getItem('remote_dt_id');
        if (!id) {
            id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/-/g, '').slice(0, 20);
            sessionStorage.setItem('remote_dt_id', id);
        }
        return id;
    } catch {
        return `${Date.now()}${Math.random()}`.replace('.', '').slice(0, 20);
    }
}

export function useRemoteDienThoai(ma) {
    const [booth, setBooth] = useState(null);       // payload SK_BOOTH gần nhất
    const [pha, setPha] = useState('dang_vao');     // 'dang_vao' | 'vao' | 'da_co_nguoi' | 'het_han'
    const [ketNoi, setKetNoi] = useState('on');
    const [daBam, setDaBam] = useState(false);      // vừa bấm, chờ booth báo đang chụp
    const kenhRef = useRef(null);
    const idRef = useRef(null);
    const lanCuoiRef = useRef(0);
    const daGapRef = useRef(false);

    useEffect(() => {
        if (!maHopLe(ma) || !isSupabaseBrowserConfigured || !supabase) { setPha('het_han'); return undefined; }
        const id = maDienThoai();
        idRef.current = id;
        const kenh = supabase.channel(tenKenh(ma), { config: { broadcast: { self: false, ack: false } } });
        kenhRef.current = kenh;
        const gui = (loai) => kenh.send({ type: 'broadcast', event: SK_DT, payload: { loai, id } }).catch(() => {});
        const batDau = Date.now();
        kenh.on('broadcast', { event: SK_BOOTH }, ({ payload }) => {
            if (!payload) return;
            lanCuoiRef.current = Date.now();
            daGapRef.current = true;
            setKetNoi('on');
            if (!payload.chu) { gui('chao'); return; } // booth chưa nhận ai (gói chào lạc) -> chào lại
            if (payload.chu !== id) { setPha('da_co_nguoi'); return; }
            setPha('vao');
            setBooth(payload);
        });
        kenh.subscribe((status) => { if (status === 'SUBSCRIBED') gui('chao'); });
        const nhip = setInterval(() => {
            const now = Date.now();
            if (!daGapRef.current) {
                if (now - batDau > KHONG_THAY_BOOTH_MS) setPha((p) => (p === 'dang_vao' ? 'het_han' : p));
                else gui('chao');
                return;
            }
            gui('ping');
            const im = now - lanCuoiRef.current;
            if (im > MAT_SAU_MS) setKetNoi('lost');
            if (im > HET_HAN_MS) setPha((p) => (p === 'vao' ? 'het_han' : p));
        }, NHIP_MS);
        return () => {
            clearInterval(nhip);
            try { supabase.removeChannel(kenh); } catch { /* bỏ qua */ }
            kenhRef.current = null;
        };
    }, [ma]);

    // Booth báo đã sang trạng thái khác -> mở lại nút.
    useEffect(() => { setDaBam(false); }, [booth?.trangThai, booth?.daChup, booth?.buoc]);

    const chup = useCallback(() => {
        if (!kenhRef.current || !idRef.current) return;
        setDaBam(true);
        kenhRef.current.send({ type: 'broadcast', event: SK_DT, payload: { loai: 'chup', id: idRef.current } }).catch(() => setDaBam(false));
        try { navigator.vibrate?.(30); } catch { /* bỏ qua */ }
    }, []);

    // Không có phản hồi sau 4 s (gói lạc) -> cho bấm lại.
    useEffect(() => {
        if (!daBam) return undefined;
        const t = setTimeout(() => setDaBam(false), 4000);
        return () => clearTimeout(t);
    }, [daBam]);

    return { pha, booth, ketNoi, daBam, chup };
}
