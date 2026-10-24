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

// Tên anchor hợp lệ trong khai báo warp -> điểm trên geometry. ai-filters.json viết kiểu 'left_eye' còn geometry
// dùng 'leftEye' -> trước đây các warp ở mắt rơi hết về giữa mặt. Nhận cả hai kiểu viết.
function anchorPoint(face, name) {
    const camel = String(name).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    return face.points[name] || face.points[camel] || face.points.faceCenter;
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
                // Texture được nạp với UNPACK_FLIP_Y nên trục y trong shader NGƯỢC với y của
                // landmark (0 = đỉnh ảnh). Không lật ở đây thì warp rơi vào vị trí đối xứng
                // qua giữa ảnh (đã đo: tâm mặt y=452px nhưng warp tác động ở y=543px).
                cy: 1 - pt.y,
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
        }, {
            // Card đồ hoạ lỗi giữa chừng: vẽ lại ảnh gốc thay vì giữ thêm một bản sao cỡ ảnh.
            restore: (c) => c.drawImage(image, 0, 0, width, height),
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
