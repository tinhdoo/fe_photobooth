// tachNenBackend.js — tách người khỏi nền cho ẢNH THẺ bằng model chạy ở backend booth (/api/idphoto/matte).
//
// So trên 2 ảnh thật qua đúng khung ảnh thẻ (2026-10-23):
//   MediaPipe (trình duyệt)  ~0,3 s   mask 256x256 thô: mất tai bờm, sót mảng nền, ngón tay nhoè
//   PP-MattingV2 (backend)   ~0,5 s   sạch hơn nhiều nhưng còn đốm / mảng nền sót ở vai, góc ảnh
//   BiRefNet-512 (backend)   5-20 s   sạch nhất (ngón tay, bờm tai, không sót nền)
// => thử BiRefNet trước, quá giờ / lỗi thì PP-MattingV2, cuối cùng MediaPipe. Khách không bao giờ kẹt.
// Backend chỉ trả LỚP ALPHA; refineAlpha + khử ám màu ở replaceBackground.js vẫn làm như cũ.

import axios from 'axios';
import { API_URL } from '../config/api';
import { segmentPerson } from '../faceFilter/engine/personSegmenter';

const BUOC = [
    { model: 'birefnet512', han: 30000, nhan: 'Đang tách nền bằng AI (khoảng 10–20 giây)…' },
    { model: 'ppmattingv2', han: 8000, nhan: 'Đang tách nền…' },
];

// Máy yếu thì BiRefNet quá giờ gần như lần nào cũng quá -> bỏ qua 24 giờ, khỏi bắt từng khách chờ 30 s rồi
// mới rơi về model nhẹ. Phải quá giờ HAI LẦN LIỀN mới bỏ: một lần lẻ có thể chỉ vì nạp model nguội (backend vừa
// khởi động lại, chưa kịp /warm) hoặc đang đợi lượt của khách trước. Thành công một lần là xoá đếm.
const KHOA_CHAM = 'ID_MATTE_CHAM_DEN';
const KHOA_DEM = 'ID_MATTE_QUA_GIO';
const BO_QUA_MS = 24 * 60 * 60 * 1000;

const dangBoQua = (model) => {
    if (model !== 'birefnet512') return false;
    try { return Number(localStorage.getItem(KHOA_CHAM) || 0) > Date.now(); } catch { return false; }
};
const ghiQuaGio = () => {
    try {
        const n = Number(localStorage.getItem(KHOA_DEM) || 0) + 1;
        if (n >= 2) {
            localStorage.setItem(KHOA_CHAM, String(Date.now() + BO_QUA_MS));
            localStorage.removeItem(KHOA_DEM);
        } else {
            localStorage.setItem(KHOA_DEM, String(n));
        }
    } catch { /* bộ nhớ trình duyệt bị chặn */ }
};
const xoaDemQuaGio = () => {
    try { localStorage.removeItem(KHOA_DEM); } catch { /* như trên */ }
};

/** Nạp sẵn model ở backend (gọi lúc khách chọn "Ảnh thẻ") để tới bước 8 khỏi chờ nạp. Lỗi thì bỏ qua. */
export function napTruocTachNen() {
    const models = BUOC.map((b) => b.model).filter((m) => !dangBoQua(m));
    axios.post(`${API_URL}/api/idphoto/matte/warm`, { models }, { timeout: 5000 }).catch(() => {});
}

async function alphaTuBackend(src, w, h, model, han) {
    const blob = await new Promise((ok, loi) => src.toBlob((b) => (b ? ok(b) : loi(new Error('không xuất được ảnh'))), 'image/jpeg', 0.95));
    const fd = new FormData();
    fd.append('file', blob, 'anhthe.jpg');
    fd.append('model', model);
    fd.append('w', String(w));
    fd.append('h', String(h));
    const res = await axios.post(`${API_URL}/api/idphoto/matte`, fd, { timeout: han, responseType: 'blob' });

    const bmp = await createImageBitmap(res.data);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const d = ctx.getImageData(0, 0, w, h).data;
    const mask = new Float32Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4] / 255;
    return mask;
}

/**
 * Cùng hợp đồng với segmentPerson: trả { mask: Float32Array [0..1] cỡ w x h, width, height } + `nguon`.
 * @param {HTMLCanvasElement} src ảnh đã cắt về khuôn ảnh thẻ
 */
export async function tachNenAnhThe(src, w, h, onTienDo) {
    for (const b of BUOC) {
        if (dangBoQua(b.model)) continue;
        try {
            onTienDo?.(b.nhan);
            const mask = await alphaTuBackend(src, w, h, b.model, b.han);
            if (b.model === 'birefnet512') xoaDemQuaGio();
            return { mask, width: w, height: h, nguon: b.model };
        } catch (e) {
            const quaGio = e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message || '');
            if (quaGio && b.model === 'birefnet512') ghiQuaGio();
            console.warn('[idPhoto] tách nền %s lỗi, thử cách khác: %s', b.model, e?.message || e);
        }
    }
    onTienDo?.('Đang tách nền…');
    const r = await segmentPerson(src, { outWidth: w, outHeight: h });
    return { ...r, nguon: 'mediapipe' };
}
