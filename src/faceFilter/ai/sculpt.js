// sculpt.js — "Gương mặt": gọn mặt, to mắt, thon mũi. Dựng warp primitive (warpEngine.js) từ hình học mặt.
// looks[i].beauty = { slimFace, bigEyes, slimNose } (0..1) cho faces[i].
// Đơn vị: toạ độ chuẩn hoá 0..1; khoảng cách theo chiều cao ảnh (x nhân aspect) như metrics của geometry.js.

// Vị trí trong vòng faceOval (geometry.js FACE_OVAL) của mép hàm hai bên, từ dưới gò má xuống gần cằm,
// kèm tỉ lệ lực kéo: góc hàm kéo mạnh nhất.
const JAW_A = [[10, 0.8], [12, 1], [14, 0.7]];
const JAW_B = [[26, 0.8], [24, 1], [22, 0.7]];

// Gọn mặt tối đa: 3 điểm mỗi bên chồng lên nhau -> góc hàm vào trong ~7,5% bề rộng mặt. Bán kính 0,22 để khoé
// miệng gần như đứng yên (lệch <= 2,5% bề rộng mặt, đo 23/10 trên ảnh đôi nghiêng đầu); 0,3 thì miệng bị bóp méo.
const SLIM_PULL = 0.07;
const SLIM_RADIUS = 0.22;  // vùng ảnh hưởng quanh mỗi điểm hàm (x bề rộng mặt)
const EYE_SCALE = 0.25;    // to mắt tối đa (hệ số phóng ở tâm tròng đen)
const EYE_RADIUS = 1.1;    // x bề rộng mắt
const NOSE_SCALE = 0.28;   // thon mũi tối đa (thu theo chiều ngang)
const NOSE_RADIUS = 0.17;  // x bề rộng mặt

const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** Có chỉnh gương mặt không (để khỏi chạy warp khi không cần). */
export function hasSculpt(looks) {
    return looks.some((l) => clamp01(l?.beauty?.slimFace) > 0 || clamp01(l?.beauty?.bigEyes) > 0 || clamp01(l?.beauty?.slimNose) > 0);
}

/** Primitive cho warpEngine.render: cy và dy theo uv đã lật y (texture nạp với FLIP_Y). */
export function buildSculptPrimitives(faces, looks, aspect) {
    const out = [];
    const push = (p, radius, extra) => out.push({ cx: p.x, cy: 1 - p.y, radius, ...extra });
    faces.forEach((f, i) => {
        const b = looks[i]?.beauty || {};
        const slim = clamp01(b.slimFace), eyes = clamp01(b.bigEyes), nose = clamp01(b.slimNose);
        const fw = f.metrics.faceW;

        if (slim > 0) {
            // Trục mặt: trán -> cằm. Kéo từng điểm hàm về phía trục (vuông góc), theo đúng độ nghiêng đầu.
            const a = { x: f.points.forehead.x * aspect, y: f.points.forehead.y };
            const c = { x: f.points.chin.x * aspect, y: f.points.chin.y };
            const ax = c.x - a.x, ay = c.y - a.y, al = Math.hypot(ax, ay) || 1;
            [...JAW_A, ...JAW_B].forEach(([idx, w]) => {
                const p = f.rings.faceOval[idx];
                if (!p) return;
                const px = p.x * aspect, py = p.y;
                const t = ((px - a.x) * ax + (py - a.y) * ay) / (al * al);
                const qx = a.x + ax * t, qy = a.y + ay * t;
                const dl = Math.hypot(qx - px, qy - py) || 1;
                const amt = slim * SLIM_PULL * fw * w;
                push(p, fw * SLIM_RADIUS, { dx: ((qx - px) / dl) * amt, dy: -((qy - py) / dl) * amt });
            });
        }
        if (eyes > 0) {
            const r = (f.metrics.eyeW || fw * 0.2) * EYE_RADIUS;
            [f.points.irisLeft || f.points.leftEye, f.points.irisRight || f.points.rightEye].forEach((p) => {
                if (p) push(p, r, { sx: eyes * EYE_SCALE, sy: eyes * EYE_SCALE });
            });
        }
        if (nose > 0 && f.points.nostrilLeft && f.points.nostrilRight) {
            const nb = { x: (f.points.nostrilLeft.x + f.points.nostrilRight.x) / 2, y: (f.points.nostrilLeft.y + f.points.nostrilRight.y) / 2 };
            const p = { x: (nb.x + f.points.nose.x) / 2, y: (nb.y + f.points.nose.y) / 2 };
            push(p, fw * NOSE_RADIUS, { sx: -nose * NOSE_SCALE, sy: 0 });
        }
    });
    return out;
}
