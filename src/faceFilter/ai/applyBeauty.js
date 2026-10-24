// applyBeauty.js — áp 1 beauty preset (định nghĩa JSON) lên 1 ảnh, trả về objectURL ảnh kết quả.
// Dùng cho bước Edit của booth (xử lý từng ảnh đã chọn).

import { getFaceLandmarker, MAX_FACES } from '../engine/faceLandmarkerClient.js';
import { loadAsset } from '../engine/stickerRenderer.js';
import { buildFaceGeometry, selectFaces } from './geometry.js';
import { renderAIFilter } from './aiPipeline.js';
import { applyLookFaces, healSpots } from './lookStage.js';
import { faceLook } from './photoEditState.js';
import { buildSculptPrimitives, hasSculpt } from './sculpt.js';
import { getWarpEngine } from './warpEngine.js';

/** Lấy các preset thuộc nhóm Beauty từ ai-filters.json. */
export async function loadBeautyPresets() {
    const res = await fetch(`/face-filters/ai-filters.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Không tải được ai-filters.json');
    const data = await res.json();
    return (Array.isArray(data.filters) ? data.filters : []).filter((f) => f && f.category === 'Beauty');
}

/** Preset làm đẹp mặc định dùng kèm các filter chỉ-đổi-màu (Đen Trắng / Cổ Điển / Sepia). */
export const DEFAULT_SKIN_PRESET_ID = 'natural';

/**
 * Áp preset lên ảnh (URL) -> trả về CANVAS ở ĐỘ PHÂN GIẢI GỐC.
 * Trả canvas (không phải blob) để bên gọi còn xử lý tiếp — ví dụ đổi màu sang đen trắng —
 * mà KHÔNG phải nén JPEG rồi giải nén lại giữa chừng (vừa mất chất lượng vừa chậm).
 * Nếu không thấy mặt thì vẫn áp color grade toàn cục (engine tự xử lý).
 */
export async function applyBeautyToCanvas(imageUrl, filter, { maxFaces = MAX_FACES } = {}) {
    const img = await loadAsset(imageUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    const landmarker = await getFaceLandmarker({ maxFaces });
    const result = landmarker.detect(img);
    const faces = selectFaces((result.faceLandmarks || [])
        .map((lm) => buildFaceGeometry(lm, w / h))
        .filter(Boolean));

    return renderAIFilter({ image: img, faces, filter, width: w, height: h });
}

// --- Dùng cho bước Chỉnh ảnh (5.5): dò mặt MỘT lần, xem trước ở cỡ nhỏ, xuất ảnh gốc khi xong. ---

// Khung bao (chuẩn hoá) của một bộ landmark.
const lmBox = (lm) => {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    lm.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    return { x0, y0, x1, y1 };
};
const overlap = (a, b) => {
    const iw = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), ih = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (iw <= 0 || ih <= 0) return 0;
    return (iw * ih) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
};

/**
 * Dò mặt trên ảnh (thường là bản thu nhỏ). Toạ độ chuẩn hoá 0..1 nên dùng lại được cho mọi cỡ ảnh.
 * Bộ dò của MediaPipe nhìn cả ảnh ở độ phân giải thấp -> mặt nhỏ (ảnh nhóm đứng xa, dải nhiều ô) bị sót. Vì vậy
 * dò thêm trên các ô chồng nhau (cạnh = nửa cạnh ngắn của ảnh, chồng 50%), quy toạ độ về cả ảnh rồi bỏ mặt trùng
 * và mặt bị mép ô cắt dở.
 */
export async function detectFacesOn(source, { maxFaces = MAX_FACES } = {}) {
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    const landmarker = await getFaceLandmarker({ maxFaces });
    const found = (landmarker.detect(source).faceLandmarks || []).map((lm) => ({ lm, box: lmBox(lm) }));

    const T = Math.round(Math.min(w, h) / 2);
    // Chỉ dò thêm khi đáng ngờ còn sót: chưa thấy ai, hoặc đã có mặt nhỏ (ảnh đông người / đứng xa). Ảnh chân dung
    // mặt to thì bỏ qua (dò theo ô tốn thêm ~0,1 s mỗi ô).
    const shortSide = Math.min(w, h);
    const hasSmall = found.some((f) => Math.min((f.box.x1 - f.box.x0) * w, (f.box.y1 - f.box.y0) * h) < shortSide * 0.2);
    if (T >= 160 && (!found.length || hasSmall)) {
        const tile = document.createElement('canvas');
        tile.width = T;
        tile.height = T;
        const tctx = tile.getContext('2d');
        const step = T / 2;
        const xs = [], ys = [];
        for (let x = 0; x + T < w + step / 2; x += step) xs.push(Math.min(Math.round(x), w - T));
        for (let y = 0; y + T < h + step / 2; y += step) ys.push(Math.min(Math.round(y), h - T));
        const edge = 0.01; // mặt chạm mép ô (không phải mép ảnh) = bị cắt dở -> bỏ, ô kề bên sẽ thấy trọn
        for (const ty of ys) {
            for (const tx of xs) {
                tctx.clearRect(0, 0, T, T);
                tctx.drawImage(source, tx, ty, T, T, 0, 0, T, T);
                for (const raw of landmarker.detect(tile).faceLandmarks || []) {
                    const b = lmBox(raw);
                    const cut = (b.x0 < edge && tx > 0) || (b.y0 < edge && ty > 0)
                        || (b.x1 > 1 - edge && tx + T < w) || (b.y1 > 1 - edge && ty + T < h);
                    if (cut) continue;
                    const lm = raw.map((p) => ({ x: (tx + p.x * T) / w, y: (ty + p.y * T) / h, z: p.z }));
                    const box = lmBox(lm);
                    if (found.some((f) => overlap(f.box, box) > 0.3)) continue;
                    found.push({ lm, box });
                }
            }
        }
    }
    return selectFaces(found
        .map((f) => buildFaceGeometry(f.lm, w / h))
        .filter(Boolean));
}

/**
 * Vẽ trạng thái chỉnh (photoEditState.js: chung + từng người + màu + chấm xoá mụn) lên ảnh ở cỡ width x height
 * -> canvas mới. Thứ tự: xoá mụn -> làm đẹp/trang điểm/màu -> gương mặt (warp kéo theo lớp trang điểm đã vẽ,
 * mask làm đẹp khớp landmark gốc). Toạ độ chuẩn hoá nên cùng `faces` dùng được cho xem trước lẫn ảnh gốc.
 */
export function renderEdit(source, faces, edit, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const spots = edit?.spots || [];
    const draw = (c) => { c.drawImage(source, 0, 0, width, height); healSpots(c.canvas, spots); };
    draw(ctx);
    const looks = faces.map((_, i) => faceLook(edit, i));
    applyLookFaces(canvas, faces, looks, edit?.color || {}, { restore: draw });
    if (faces.length && hasSculpt(looks)) {
        try {
            // Card yếu chứa được ít primitive mỗi lượt (có thể chỉ 4) -> chia theo mặt thành nhiều lượt, để không
            // bỏ rơi âm thầm phần thừa (mất một bên hàm = mặt lệch). Mặt vượt sức chứa một lượt thì cắt nhỏ tiếp.
            const per = faces.map((f, i) => buildSculptPrimitives([f], [looks[i]], width / height));
            const cap = getWarpEngine().maxWarps;
            let batch = [];
            const flush = () => { if (batch.length) warpRegion(canvas, batch); batch = []; };
            per.forEach((list) => {
                if (list.length > cap) {
                    flush();
                    for (let i = 0; i < list.length; i += cap) warpRegion(canvas, list.slice(i, i + cap));
                    return;
                }
                if (batch.length + list.length > cap) flush();
                batch.push(...list);
            });
            flush();
        } catch (e) {
            console.warn('[renderEdit] Không bóp mặt được (WebGL), giữ ảnh chưa bóp:', e);
        }
    }
    return canvas;
}

// Bóp mặt chỉ trên khung bao các vùng ảnh hưởng (ngoài các vòng tròn ảnh không đổi) rồi dán lại: ảnh 6000 px
// không phải đẩy cả ảnh qua card đồ hoạ (cả ảnh ~1,5 s). Primitive đổi sang toạ độ của khung cắt.
// Lỗi (kể cả mất ngữ cảnh WebGL giữa chừng) thì ném ra TRƯỚC khi dán -> ảnh giữ nguyên, không dính ô trống.
function warpRegion(canvas, prims) {
    if (!prims.length) return;
    const W = canvas.width, H = canvas.height;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    prims.forEach((p) => {
        const r = p.radius * H + 2, x = p.cx * W, y = (1 - p.cy) * H;
        x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r);
        x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r);
    });
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    const cw = x1 - x0, ch = y1 - y0;
    if (cw < 2 || ch < 2) return;
    const crop = document.createElement('canvas');
    crop.width = cw;
    crop.height = ch;
    crop.getContext('2d').drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
    const k = H / ch; // bán kính / vector kéo tính theo chiều cao ảnh -> theo chiều cao khung cắt
    const local = prims.map((p) => ({
        ...p,
        cx: (p.cx * W - x0) / cw,
        cy: 1 - ((1 - p.cy) * H - y0) / ch,
        radius: p.radius * k,
        dx: (p.dx || 0) * k,
        dy: (p.dy || 0) * k,
    }));
    const eng = getWarpEngine();
    const out = eng.render(crop, cw, ch, local);
    if (eng.gl.isContextLost()) throw new Error('Mất ngữ cảnh WebGL khi bóp mặt');
    canvas.getContext('2d').drawImage(out, 0, 0, cw, ch, x0, y0, cw, ch);
}

/** canvas -> objectURL JPEG (null nếu trình duyệt không nén được). */
export function canvasToObjectUrl(canvas, quality = 0.95) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), 'image/jpeg', quality));
}

/**
 * Áp preset lên ảnh (URL) -> objectURL JPEG ở ĐỘ PHÂN GIẢI GỐC.
 * `after` (tuỳ chọn): hàm (ctx, w, h) chạy TRÊN CÙNG canvas sau khi làm đẹp xong — dùng để
 * ghép filter đổi màu vào sau. Thứ tự này bắt buộc: tầng làm đẹp cần MÀU DA THẬT để đo và
 * chỉnh tông, nên phải chạy khi ảnh còn màu, rồi mới chuyển đen trắng/sepia.
 */
export async function applyBeautyToImage(imageUrl, filter, { maxFaces = MAX_FACES, quality = 0.95, after = null } = {}) {
    const canvas = await applyBeautyToCanvas(imageUrl, filter, { maxFaces });
    if (typeof after === 'function') {
        after(canvas.getContext('2d'), canvas.width, canvas.height);
    }
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : imageUrl), 'image/jpeg', quality));
}
