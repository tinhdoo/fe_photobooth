// stickerRenderer.js
// Vẽ ảnh gốc + các sticker của filter lên canvas theo độ phân giải gốc (giữ nét ảnh hi-res).
// Mỗi asset được scale theo kích thước khuôn mặt và xoay theo góc đầu.

import { resolveAnchorPoint } from './landmarks.js';

const imageCache = new Map();

/** Load 1 asset (png/svg/...) thành HTMLImageElement, có cache. */
export function loadAsset(url) {
    if (imageCache.has(url)) return imageCache.get(url);
    const promise = new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Không tải được asset: ${url}`));
        img.src = url;
    });
    imageCache.set(url, promise);
    return promise;
}

// "base" để quy chiếu scale: faceWidth hoặc interocular (khoảng cách 2 mắt).
function metricFor(frame, basis) {
    return basis === 'interocular' ? frame.interocular : frame.faceWidth;
}

/**
 * Vẽ 1 asset cho 1 khuôn mặt.
 * asset: { image(url đã resolve), anchor, scale, basis, offset, rotate, opacity }
 */
async function drawAsset(ctx, frame, asset) {
    const img = await loadAsset(asset.image);
    const base = metricFor(frame, asset.basis);
    const targetW = base * (asset.scale ?? 1);
    const ratio = (img.naturalHeight || img.height) / (img.naturalWidth || img.width) || 1;
    const targetH = targetW * ratio;

    const point = resolveAnchorPoint(frame, asset.anchor, asset.offset);
    const rotate = asset.rotate !== false; // mặc định xoay theo đầu

    // anchorY: vị trí điểm neo so với sticker theo chiều dọc.
    //   'center' (mặc định) = giữa; 'bottom' = đáy sticker đặt tại điểm neo (mũ/tai/vương miện
    //   "ngồi" lên đầu); 'top' = đỉnh sticker tại điểm neo.
    let topY = -targetH / 2;
    if (asset.anchorY === 'bottom') topY = -targetH;
    else if (asset.anchorY === 'top') topY = 0;

    ctx.save();
    ctx.globalAlpha = asset.opacity ?? 1;
    ctx.translate(point.x, point.y);
    if (rotate) ctx.rotate(frame.roll);
    if (asset.flipX) ctx.scale(-1, 1);
    ctx.drawImage(img, -targetW / 2, topY, targetW, targetH);
    ctx.restore();
}

/**
 * Vẽ toàn bộ: ảnh gốc + (nếu có filter) các asset cho TỪNG khuôn mặt.
 * @param canvas   canvas đích (sẽ được set đúng kích thước ảnh gốc)
 * @param image    HTMLImageElement ảnh gốc đã load
 * @param faces    mảng frame từ detectFaces
 * @param filter   object filter (đã resolve url asset) hoặc null = không filter
 */
export async function renderToCanvas(canvas, image, faces, filter) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    if (!filter || !Array.isArray(filter.assets)) return;

    for (const frame of faces) {
        // Vẽ tuần tự theo thứ tự khai báo để giữ đúng lớp chồng (ví dụ tai sau, mũi trước).
        for (const asset of filter.assets) {
            try {
                await drawAsset(ctx, frame, asset);
            } catch (err) {
                console.warn('[FaceFilter] Bỏ qua asset lỗi:', asset?.image, err);
            }
        }
    }
}

/** Xuất canvas ra dataURL JPEG chất lượng cao. */
export function canvasToDataUrl(canvas, quality = 0.95) {
    return canvas.toDataURL('image/jpeg', quality);
}

/** Xuất canvas ra Blob (dùng tạo objectURL như luồng chụp gốc). */
export function canvasToBlob(canvas, quality = 0.95) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}
