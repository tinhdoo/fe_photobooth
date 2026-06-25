// aiPipeline.js
// Ghép 2 tầng: LOOK (làm đẹp/màu, Canvas 2D) -> WARP (liquify, WebGL).
// Làm look trước để mask khớp landmark gốc; warp kéo theo lớp makeup đã vẽ.
// Mọi toạ độ chuẩn hoá 0..1 nên render được ở mọi kích thước (preview nhỏ / export gốc).

import { applyLook } from './lookStage.js';
import { getWarpEngine } from './warpEngine.js';

function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

// Tên anchor hợp lệ trong khai báo warp -> điểm trên geometry.
function anchorPoint(face, name) {
    return face.points[name] || face.points.faceCenter;
}

/**
 * Dịch khai báo filter.warps (JSON) thành mảng warp primitive cho engine.
 * Mỗi warp: { anchor, radius(=bội số faceW), strength(+to/-nhỏ), axis: both|x|y }
 */
export function buildPrimitives(filter, faces) {
    const warps = Array.isArray(filter.warps) ? filter.warps : [];
    const out = [];
    faces.forEach((face) => {
        warps.forEach((w) => {
            const pt = anchorPoint(face, w.anchor || 'faceCenter');
            const radius = (w.radius ?? 0.5) * face.metrics.faceW;
            const s = w.strength ?? 0;
            const axis = w.axis || 'both';
            out.push({
                cx: pt.x,
                cy: pt.y,
                radius,
                sx: axis === 'y' ? 0 : s,
                sy: axis === 'x' ? 0 : s,
            });
        });
    });
    return out;
}

/**
 * Render 1 filter lên ảnh ở kích thước (width,height) cho trước.
 * @returns canvas kết quả (bản sao độc lập, an toàn để dùng tiếp).
 */
export function renderAIFilter({ image, faces, filter, width, height }) {
    const work = makeCanvas(width, height);
    const ctx = work.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);

    // 1) Làm đẹp + màu (chỉ khi có mặt thì mới mask/makeup; color grade vẫn áp toàn ảnh).
    if (filter) {
        applyLook(work, faces, {
            beauty: filter.beauty,
            makeup: filter.makeup,
            color: filter.color,
        });
    }

    // 2) Warp (nếu có khai báo).
    const primitives = filter ? buildPrimitives(filter, faces) : [];
    if (!primitives.length) return work;

    const gl = getWarpEngine().render(work, width, height, primitives);
    const result = makeCanvas(width, height);
    result.getContext('2d').drawImage(gl, 0, 0);
    return result;
}
