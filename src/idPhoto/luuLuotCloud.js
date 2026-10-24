// luuLuotCloud.js — lưu LƯỢT ẢNH THẺ lên cloud sau khi in: tờ in làm ảnh album (QR ở màn Kết quả) + bản ghi lượt
// cho trang Doanh thu. Luồng ảnh thẻ không đi qua Edit.jsx (nơi luồng ảnh chơi làm việc này), nên 0.0.27 in xong
// thì màn Kết quả không có QR và lượt đã trả tiền không vào doanh thu. Các trường thanh toán GIỮ KHỚP Edit.jsx
// (bước "8. Upload & Create Session"): đổi bên kia thì đổi cả ở đây.

import axios from 'axios';
import { API_URL, CLOUD_API_URL } from '../config/api';
import { getDeviceId } from '../utils/deviceId';

const coSo = () => CLOUD_API_URL || API_URL;

const thanhBlob = (canvas, type = 'image/jpeg', q = 0.92) =>
    new Promise((ok, loi) => canvas.toBlob((b) => (b ? ok(b) : loi(new Error('Không xuất được ảnh'))), type, q));

// Giống uploadFile của Edit.jsx: tối đa ~4,5 MB (giới hạn Vercel), 90 s đủ cho đường lên chậm.
async function taiLen(blob, ten) {
    const fd = new FormData();
    fd.append('file', blob, ten);
    try {
        const res = await axios.post(`${coSo()}/api/upload-cloud`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 90000,
        });
        return { url: res.data.url, public_id: res.data.public_id };
    } catch (e) {
        throw new Error(e.response?.data?.error || e.message || 'Không rõ lỗi tải ảnh lên');
    }
}

/**
 * @param {HTMLCanvasElement} to   tờ in (1200x1800) đã gửi máy in
 * @param {HTMLCanvasElement} anh  MỘT ảnh thẻ đã xử lý (để khách tải riêng từ album); lỗi thì bỏ qua
 * @param {string} maLuot          mã lượt = mã lần in (sessionData.printAttemptId), cũng là mã album trong QR
 * @returns {Promise<string>} url ảnh tờ in trên cloud
 */
export async function luuLuotAnhThe({ to, anh, maLuot, sessionData, soTo }) {
    const [toUp, anhUp] = await Promise.all([
        thanhBlob(to).then((b) => taiLen(b, `idphoto_sheet_${Date.now()}.jpg`)),
        anh ? thanhBlob(anh).then((b) => taiLen(b, `idphoto_${Date.now()}.jpg`)).catch(() => null) : null,
    ]);

    const daTra = sessionData.paymentStatus === 'completed';
    await axios.post(`${coSo()}/api/sessions`, {
        layout_id: sessionData.layout?.id || 'id_photo_mixed',
        composite_url: toUp.url,
        composite_public_id: toUp.public_id,
        photos: anhUp ? [{ url: anhUp.url, public_id: anhUp.public_id, video_url: null, video_public_id: null, type: 'raw' }] : [],
        // Sự kiện (miễn phí) -> 0đ, 'event'; theo việc lượt ĐÃ TRẢ chứ không theo chế độ đang bật (xem Edit.jsx).
        payment_method: daTra ? (sessionData.paymentMethod || 'cash') : 'event',
        amount: daTra ? (sessionData.printPrice || 0) : 0,
        session_id: maLuot,
        meta_data: {
            device_id: getDeviceId(),
            capture_mode: 'id',
            print_mode: sessionData.layout?.printMode || 'id_photo_4x6',
            print_quantity: soTo,
            cash_inserted: sessionData.cashInserted || 0,
            cash_trace: sessionData.cashTrace || undefined,
            payment_code: sessionData.paymentCode || null,
            payment_code_value: sessionData.paymentCodeValue || null,
            payment_code_applied: sessionData.paymentCodeApplied || null,
            sepay_order_code: sessionData.sepayOrderCode || null,
            sepay_order_codes: sessionData.sepayOrderCodes || undefined,
            qr_paid: sessionData.qrPaid || undefined,
        },
    }, { timeout: 20000 });

    // Gắn mã thanh toán với lượt (admin biết mã dùng cho lượt nào). Lỗi mạng không chặn khách.
    if (sessionData.paymentCodeId) {
        axios.post(`${coSo()}/api/codes`, { action: 'set-session', id: sessionData.paymentCodeId, session_id: maLuot })
            .catch((e) => console.warn('Gắn mã với lượt ảnh thẻ thất bại:', e));
    }
    return toUp.url;
}
