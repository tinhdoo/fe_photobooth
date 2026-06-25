// applyBeauty.js — áp 1 beauty preset (định nghĩa JSON) lên 1 ảnh, trả về objectURL ảnh kết quả.
// Dùng cho bước Edit của booth (xử lý từng ảnh đã chọn).

import { getFaceLandmarker } from '../engine/faceLandmarkerClient.js';
import { loadAsset } from '../engine/stickerRenderer.js';
import { buildFaceGeometry } from './geometry.js';
import { renderAIFilter } from './aiPipeline.js';

/** Lấy các preset thuộc nhóm Beauty từ ai-filters.json. */
export async function loadBeautyPresets() {
    const res = await fetch(`/face-filters/ai-filters.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Không tải được ai-filters.json');
    const data = await res.json();
    return (Array.isArray(data.filters) ? data.filters : []).filter((f) => f && f.category === 'Beauty');
}

/**
 * Áp preset lên ảnh (URL) -> objectURL JPEG ở ĐỘ PHÂN GIẢI GỐC.
 * Nếu không thấy mặt thì vẫn áp color grade toàn cục (engine tự xử lý).
 */
export async function applyBeautyToImage(imageUrl, filter, { maxFaces = 5, quality = 0.95 } = {}) {
    const img = await loadAsset(imageUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    const landmarker = await getFaceLandmarker({ maxFaces });
    const result = landmarker.detect(img);
    const faces = (result.faceLandmarks || [])
        .map((lm) => buildFaceGeometry(lm, w / h))
        .filter(Boolean);

    const canvas = renderAIFilter({ image: img, faces, filter, width: w, height: h });
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : imageUrl), 'image/jpeg', quality));
}
