// toAnhThe.js — dựng TỜ IN ảnh thẻ 4x6 inch: ô ảnh theo `layout.boxes` (layouts.js, tính bằng mm) + khung PNG phủ
// (admin tải lên ở Quản lý khung > Ảnh thẻ). Dùng chung cho xem trước, bản in và ảnh mẫu tải về cho người thiết kế
// khung -> ba thứ luôn khớp nhau.

import { LAYOUTS } from '../data/layouts';

// Tờ 4x6 inch ở 300 DPI.
export const SHEET_W = 1200;
export const SHEET_H = 1800;

/** Các kiểu tờ ảnh thẻ; phần tử đầu (id_photo_mixed) là tờ mặc định / "Không khung". */
export const KIEU_TO_ANH_THE = LAYOUTS.filter((l) => l.idPhoto);

const oTrenTo = (b, W, H) => ({
    x: (b.x / 100) * W,
    y: (b.y / 100) * H,
    w: (b.width / 100) * W,
    h: (b.height / 100) * H,
});

/**
 * Rải ảnh MỘT ô vào từng ô của tờ rồi phủ khung (nếu có).
 * @param {CanvasImageSource & {width:number,height:number}} cell ảnh một ô đã xử lý xong
 * @param {object} layout một phần tử KIEU_TO_ANH_THE
 * @param {HTMLImageElement|null} khung ảnh PNG khung đã nạp (crossOrigin) hoặc null = tờ trắng
 */
export function dungToAnhThe(cell, layout, khung = null, W = SHEET_W, H = SHEET_H) {
    const to = document.createElement('canvas');
    to.width = W;
    to.height = H;
    const ctx = to.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';

    for (const b of layout?.boxes || []) {
        const { x, y, w, h } = oTrenTo(b, W, H);
        // Ô 3x4 có tỉ lệ 0,75 còn ô 2x3 và 4x6 là 0,667 -> phải cắt "phủ kín" cho từng ô,
        // nếu kéo giãn thẳng thì mặt người trong ô 3x4 sẽ bị bè ra.
        const sRatio = cell.width / cell.height;
        const dRatio = w / h;
        let sx = 0, sy = 0, sw = cell.width, sh = cell.height;
        if (sRatio > dRatio) { sw = cell.height * dRatio; sx = (cell.width - sw) / 2; }
        else { sh = cell.width / dRatio; sy = (cell.height - sh) / 2; }
        ctx.drawImage(cell, sx, sy, sw, sh, x, y, w, h);
    }
    if (khung) ctx.drawImage(khung, 0, 0, W, H);
    return to;
}

/**
 * Ảnh MẪU cho người thiết kế khung: nền xám nhạt, các ô ảnh TRONG SUỐT có viền đỏ + cỡ cm. Mở bằng Photoshop/
 * Canva làm lớp dưới cùng, vẽ khung lên phần xám, giữ trống phần trong suốt rồi xuất PNG 1200x1800.
 */
export function veToMau(layout, W = SHEET_W, H = SHEET_H) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e9e9e9';
    ctx.fillRect(0, 0, W, H);
    const pxMoiMm = W / 101.6;
    for (const b of layout?.boxes || []) {
        const { x, y, w, h } = oTrenTo(b, W, H);
        ctx.clearRect(x, y, w, h);
        ctx.strokeStyle = '#e63946';
        ctx.lineWidth = 3;
        ctx.setLineDash([12, 8]);
        ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
        ctx.setLineDash([]);
        ctx.fillStyle = '#e63946';
        ctx.font = `bold ${Math.max(18, Math.round(w / 7))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(w / pxMoiMm / 10)}x${Math.round(h / pxMoiMm / 10)}`, x + w / 2, y + h / 2);
    }
    ctx.fillStyle = '#888';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`MẪU ${layout?.sheetLabel || ''} — 1200x1800 px — ô trong suốt = chỗ ảnh`, W / 2, H - 24);
    return c;
}
