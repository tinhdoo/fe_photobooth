// inThem.js — IN THÊM ở màn Kết quả: khách tự chọn số tờ, tự trả tiền (Payment.jsx chế độ inThem), booth in lại
// đúng file in của lượt gốc rồi ghi lần in thêm thành MỘT GIAO DỊCH RIÊNG trên cloud (meta.loai = 'in_them').

import axios from 'axios';
import { API_URL, CLOUD_API_URL } from '../config/api';
import { getDeviceId } from './deviceId';
import { getCurrentPricing } from './pricing';

export const laDaiDoi = (printMode) => printMode === 'double_strip' || printMode === 'double_strip_horizontal';
// Cùng cách suy khổ in với Edit (printerCopies) và Payment (soToCan): lệch nhau là thu tiền một số tờ, in số khác.
const kieuIn = (layout) => layout?.printMode || (layout?.type === 'strip' ? 'double_strip' : 'grid_4x6');

/**
 * Các lựa chọn in thêm, cùng đơn vị với màn Chọn số lượng: dải đôi tính theo tấm (2 tấm / tờ), còn lại theo tờ.
 * Giá = "Giá bản in thêm" × số tờ (ảnh thẻ: "In thêm ảnh thẻ" nếu có), không tính lại giá gói.
 */
export function luaChonInThem(configs, layout, laTaiLen) {
    const gia = getCurrentPricing(configs);
    const giaThe = layout?.idPhoto ? parseInt(configs?.id_photo_print_price, 10) || 0 : 0;
    const moiTo = laTaiLen ? gia.mobile_print_price : giaThe || gia.print_price;
    const dai = laDaiDoi(kieuIn(layout));
    return [1, 2, 3, 4, 5].map((soTo) => ({ soLuong: dai ? soTo * 2 : soTo, soTo, soTien: moiTo * soTo }));
}

const ngu = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * In lại file in của lượt gốc (backend /api/staff/sessions/<mã>/reprint: cùng file, khổ, kiểu cắt) rồi CHỜ máy in
 * nhận lệnh: hàng đợi in báo 'failed' (hết giấy, lỗi driver) thì ném lỗi để khách thấy và bấm Thử lại — chỉ "đã xếp
 * hàng" thì khách tưởng xong, đi về mà không có ảnh. Quá `choToiDa` vẫn 'pending' (máy in đang in lượt trước) thì coi
 * là đã gửi. `maLan` = mã lần in thêm: gửi lại cùng mã thì backend trả lệnh cũ (trừ khi lệnh cũ đã hỏng).
 */
export async function guiLenhInThem({ maInGoc, soTo, maLan, choToiDa = 25000 }) {
    const res = await axios.post(`${API_URL}/api/staff/sessions/${encodeURIComponent(maInGoc)}/reprint`, {
        copies: soTo,
        reason: 'extra',
        attempt_id: maLan,
    }, { timeout: 30000 });
    const jobId = res.data?.job?.id;
    if (!jobId) return res.data;
    const het = Date.now() + choToiDa;
    while (Date.now() < het) {
        await ngu(2000);
        let job = null;
        try {
            const r = await axios.get(`${API_URL}/api/print/jobs`, { params: { limit: 30 }, timeout: 8000 });
            job = (Array.isArray(r.data) ? r.data : []).find((j) => j && j.id === jobId) || null;
        } catch {
            // hỏi trạng thái không được -> hỏi lại vòng sau
        }
        if (job?.status === 'sent') return res.data;
        if (job?.status === 'failed') {
            const e = new Error(job.error_message || 'Máy in báo lỗi');
            e.inHong = true;
            throw e;
        }
    }
    return res.data;
}

// Bản ghi doanh thu in thêm CHỜ GỬI, giữ trong localStorage: trang tải lại (Về trang chủ chỉ chờ 15 s) hay cloud
// mất mạng cả buổi thì tiền khách đã trả vẫn lên Doanh thu ở lần mở sau. Cloud bỏ qua bản ghi trùng mã (upsert).
const KHO_CHO = 'IN_THEM_CHO_GHI';
const docKho = () => {
    try {
        const v = JSON.parse(localStorage.getItem(KHO_CHO) || '{}');
        return v && typeof v === 'object' ? v : {};
    } catch {
        return {};
    }
};
const ghiKho = (kho) => {
    try {
        localStorage.setItem(KHO_CHO, JSON.stringify(kho));
    } catch {
        // đầy / bị chặn: vẫn gửi thẳng như cũ
    }
};

async function guiMotBanGhi(muc) {
    const coSo = CLOUD_API_URL || API_URL;
    await axios.post(`${coSo}/api/sessions`, muc.body, { timeout: 20000 });
    const kho = docKho();
    delete kho[muc.body.session_id];
    ghiKho(kho);
    if (muc.payment_code_id) {
        axios.post(`${coSo}/api/codes`, { action: 'set-session', id: muc.payment_code_id, session_id: muc.body.session_id })
            .catch((e) => console.warn('Gắn mã với lần in thêm thất bại:', e));
    }
}

/** Ghi lần in thêm lên cloud (cất vào kho chờ trước, thử lại vài lần): trang Doanh thu thấy tiền khách vừa trả. */
export async function ghiLuotInThem({ maLan, maAlbum, sessionData, thanhToan, lua }) {
    const muc = {
        payment_code_id: thanhToan.payment_code_id || null,
        body: {
            layout_id: sessionData.layout?.id || 'strip_4',
            // Không gắn ảnh ghép của lượt gốc: dọn dẹp theo bản ghi này không được đụng tới file của lượt gốc.
            composite_url: null,
            photos: [],
            payment_method: thanhToan.payment_method,
            amount: thanhToan.amount,
            session_id: maLan,
            meta_data: {
                loai: 'in_them',
                in_them_cho: maAlbum || null,
                device_id: getDeviceId(),
                // Cùng nghĩa với lượt thường (Edit): print_quantity = số tấm khách chọn, printer_copies = số tờ in.
                print_quantity: lua.soLuong,
                printer_copies: lua.soTo,
                capture_mode: sessionData.captureMode || null,
                cash_inserted: thanhToan.cash_inserted || 0,
                cash_trace: thanhToan.cash_trace,
                payment_code: thanhToan.payment_code,
                payment_code_value: thanhToan.payment_code_value,
                payment_code_applied: thanhToan.payment_code_applied,
                sepay_order_code: thanhToan.sepay_order_code,
                sepay_order_codes: thanhToan.sepay_order_codes,
                qr_paid: thanhToan.qr_paid,
            },
        },
    };
    const kho = docKho();
    kho[maLan] = { ...muc, luc: Date.now() };
    ghiKho(kho);
    let loi;
    for (let lan = 0; lan < 4; lan += 1) {
        try {
            await guiMotBanGhi(muc);
            return;
        } catch (e) {
            loi = e;
            await ngu(3000 * (lan + 1));
        }
    }
    throw loi;
}

/** Gửi nốt các bản ghi in thêm còn kẹt từ lần chạy trước (gọi khi mở app). Bỏ bản ghi quá 30 ngày. */
export async function guiLaiInThemConKet() {
    const kho = docKho();
    const cu = Date.now() - 30 * 24 * 3600 * 1000;
    for (const [ma, muc] of Object.entries(kho)) {
        if (!muc?.body || (muc.luc || 0) < cu) {
            const k = docKho();
            delete k[ma];
            ghiKho(k);
            continue;
        }
        try {
            await guiMotBanGhi(muc);
            console.log('[InThem] đã gửi bù doanh thu in thêm', ma);
        } catch (e) {
            if (e?.response?.status === 400) {
                // Cloud từ chối hẳn (dữ liệu sai) -> thử lại mãi cũng vậy.
                const k = docKho();
                delete k[ma];
                ghiKho(k);
                console.error('[InThem] cloud từ chối bản ghi in thêm, bỏ:', ma, e.response?.data);
                continue;
            }
            console.warn('[InThem] gửi bù doanh thu in thêm chưa được, để lần sau:', ma, e?.message);
        }
    }
}
