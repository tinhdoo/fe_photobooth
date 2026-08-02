// lookStage.js — Beauty pipeline 6 lớp (Canvas 2D), thiết kế để TỰ NHIÊN, không "da nhựa".
//  L1 Skin Retouch   : frequency separation (giữ lỗ chân lông/texture, chỉ xoá khuyết điểm)
//  L2 Tone Correction: giảm đỏ / giảm vàng / sáng nhẹ (KHÔNG làm trắng bệt)
//  L3 Eye Enhancement: catchlight + whiten + iris contrast (KHÔNG làm mắt to)
//  L4 Lip Enhancement: tăng saturation/brightness môi (KHÔNG tô son)
//  L5 Face Sculpting : do engine warp xử lý (rất nhẹ) — không nằm ở đây
//  L6 Color Grading  : highlight / warmth / pink tint / contrast — tạo "chất" filter
// Tất cả chỉ tác động trong vùng mặt nên không lem ra nền/tóc.

function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const centroid = (ring) => {
    const s = ring.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: s.x / ring.length, y: s.y / ring.length };
};
// Co vòng polygon vào trong (về tâm) để mask không chạm chân tóc/mai/viền mặt.
const insetRing = (ring, factor) => {
    const c = centroid(ring);
    return ring.map((p) => ({ x: c.x + (p.x - c.x) * factor, y: c.y + (p.y - c.y) * factor }));
};
const avgFaceWpx = (faces, w) =>
    (faces.reduce((s, f) => s + f.metrics.faceW, 0) / faces.length) * w;

function pathRing(ctx, ring, w, h) {
    ctx.beginPath();
    ring.forEach((p, i) => {
        const x = p.x * w;
        const y = p.y * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.closePath();
}

function ringBBox(ring, w, h) {
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    return {
        x: Math.min(...xs) * w, y: Math.min(...ys) * h,
        wPx: (Math.max(...xs) - Math.min(...xs)) * w,
        hPx: (Math.max(...ys) - Math.min(...ys)) * h,
    };
}

function softBlob(ctx, x, y, r, rgb, alpha) {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${rgb},${alpha})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function blurredImageData(srcCanvas, px) {
    const { width: w, height: h } = srcCanvas;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.filter = `blur(${px}px)`;
    ctx.drawImage(srcCanvas, 0, 0);
    return ctx.getImageData(0, 0, w, h);
}

// Mask làm đẹp: CHỈ má + trán + cằm (đốm mềm), giữ nguyên mắt/lông mày/mũi/môi/tóc.
function buildSkinMask(w, h, faces) {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    faces.forEach((f) => {
        const fw = f.metrics.faceW * w;
        const blobs = [
            { p: f.points.cheekLeft, r: fw * 0.32 },
            { p: f.points.cheekRight, r: fw * 0.32 },
            { p: lerp(f.points.forehead, f.points.eyesCenter, 0.55), r: fw * 0.30 },
            { p: lerp(f.points.mouth, f.points.chin, 0.55), r: fw * 0.24 },
        ];
        blobs.forEach(({ p, r }) => {
            const x = p.x * w;
            const y = p.y * h;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(0.7, 'rgba(255,255,255,0.92)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        });
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#fff';
        pathRing(ctx, f.rings.leftEye, w, h); ctx.fill();
        pathRing(ctx, f.rings.rightEye, w, h); ctx.fill();
        pathRing(ctx, f.rings.lips, w, h); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    });
    return c;
}

// L1 + L2: retouch (frequency separation) + tone correction, chỉ trong vùng da.
function processSkin(canvas, faces, beauty) {
    const retouch = beauty.retouch ?? beauty.smooth ?? 0;
    const toneR = beauty.toneRed ?? 0;
    const toneY = beauty.toneYellow ?? 0;
    const bright = beauty.brightness ?? 0;
    if ((retouch <= 0 && toneR <= 0 && toneY <= 0 && bright <= 0) || !faces.length) return;

    const { width: w, height: h } = canvas;
    const fw = avgFaceWpx(faces, w);
    const rSmall = Math.max(0.6, fw * 0.006); // giữ texture mịn (lỗ chân lông)
    const rLarge = Math.max(2, fw * 0.028);   // xoá khuyết điểm/đốm

    const o = canvas.getContext('2d').getImageData(0, 0, w, h);
    const s = blurredImageData(canvas, rSmall);
    const l = blurredImageData(canvas, rLarge);
    const out = canvas.getContext('2d').createImageData(w, h);
    const od = o.data, sd = s.data, ld = l.data, qd = out.data;
    const addB = bright * 14; // +3~5 brightness khi bright ~0.25-0.35

    for (let i = 0; i < od.length; i += 4) {
        // Frequency separation: low-freq đã làm đều màu + high-freq (texture) giữ lại.
        let r = ld[i] + (od[i] - sd[i]);
        let g = ld[i + 1] + (od[i + 1] - sd[i + 1]);
        let b = ld[i + 2] + (od[i + 2] - sd[i + 2]);
        // Trộn với gốc theo cường độ retouch.
        r = od[i] + (r - od[i]) * retouch;
        g = od[i + 1] + (g - od[i + 1]) * retouch;
        b = od[i + 2] + (b - od[i + 2]) * retouch;
        // L2 tone: giảm đỏ (kéo R về G), giảm vàng (nâng B), sáng nhẹ.
        if (toneR > 0 && r > g) r -= (r - g) * 0.6 * toneR;
        if (toneY > 0) {
            const yellow = (r + g) / 2 - b;
            if (yellow > 0) b += yellow * 0.5 * toneY;
        }
        qd[i] = clamp8(r + addB);
        qd[i + 1] = clamp8(g + addB);
        qd[i + 2] = clamp8(b + addB);
        qd[i + 3] = 255;
    }

    const temp = makeCanvas(w, h);
    temp.getContext('2d').putImageData(out, 0, 0);
    const mask = buildSkinMask(w, h, faces);
    const tctx = temp.getContext('2d');
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(mask, 0, 0);

    canvas.getContext('2d').drawImage(temp, 0, 0);
}

// Má hồng cực nhẹ, đặt đúng gò má, clip trong mặt.
function applyBlush(canvas, faces, amount) {
    if (amount <= 0) return;
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    faces.forEach((f) => {
        const fwp = f.metrics.faceW * w;
        const cheekL = lerp(f.points.cheekLeft, f.points.leftEye, 0.25);
        const cheekR = lerp(f.points.cheekRight, f.points.rightEye, 0.25);
        ctx.save();
        pathRing(ctx, f.rings.faceOval, w, h);
        ctx.clip();
        ctx.globalCompositeOperation = 'soft-light';
        [cheekL, cheekR].forEach((c) =>
            softBlob(ctx, c.x * w, c.y * h, fwp * 0.27, '255,135,160', 0.5 * amount));
        ctx.restore();
    });
}

// L4: môi có sức sống (tăng saturation/brightness chính màu môi), KHÔNG tô son.
function enhanceLips(canvas, faces, amount) {
    if (amount <= 0) return;
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const k = Math.min(1, amount);
    faces.forEach((f) => {
        const bb = ringBBox(f.rings.lips, w, h);
        const pad = bb.wPx * 0.15;
        const bx = Math.max(0, bb.x - pad), by = Math.max(0, bb.y - pad);
        const bw = Math.min(w - bx, bb.wPx + pad * 2), bh = Math.min(h - by, bb.hPx + pad * 2);
        if (bw <= 0 || bh <= 0) return;
        const tmp = makeCanvas(Math.ceil(bw), Math.ceil(bh));
        const t = tmp.getContext('2d');
        t.filter = `saturate(${1 + 0.45 * k}) brightness(${1 + 0.07 * k})`;
        t.drawImage(canvas, bx, by, bw, bh, 0, 0, bw, bh);
        ctx.save();
        pathRing(ctx, f.rings.lips, w, h);
        ctx.clip();
        ctx.drawImage(tmp, bx, by);
        ctx.restore();
    });
}

// Tô SON có màu: đổi TÔNG màu môi nhưng GIỮ nếp môi/độ bóng (blend 'color' giữ độ sáng-tối của môi
// thật -> tự nhiên, không bệt). Mép mềm (feather) kiểu tint. Chừa răng khi cười hở bằng mask = viền
// môi NGOÀI trừ viền môi TRONG. makeup.lipstick = cường độ 0..1; makeup.lipColor = "r,g,b".
function applyLipstick(canvas, faces, makeup) {
    const amount = makeup.lipstick ?? 0;
    if (amount <= 0) return;
    const rgb = makeup.lipColor || '217,139,139'; // nude pink mặc định (tự nhiên)
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const k = Math.min(1, amount);
    faces.forEach((f) => {
        const feather = Math.max(1.5, f.metrics.faceW * w * 0.012); // mép son mềm theo cỡ mặt
        const layer = makeCanvas(w, h);
        const lc = layer.getContext('2d');
        lc.drawImage(canvas, 0, 0);
        lc.globalCompositeOperation = 'color';       // giữ sáng/tối môi, chỉ đổi sắc
        lc.globalAlpha = 0.85 * k;
        lc.fillStyle = `rgb(${rgb})`;
        lc.fillRect(0, 0, w, h);
        lc.globalCompositeOperation = 'soft-light';  // thêm chút chiều sâu, lên màu tự nhiên
        lc.globalAlpha = 0.35 * k;
        lc.fillRect(0, 0, w, h);
        lc.globalAlpha = 1;
        // Cắt theo mask môi MÉP MỀM = viền ngoài trừ viền trong (chừa răng khi cười hở).
        lc.globalCompositeOperation = 'destination-in';
        lc.filter = `blur(${feather}px)`;
        lc.fillStyle = '#fff';
        pathRing(lc, f.rings.lips, w, h); lc.fill();
        lc.filter = 'none';
        if (f.rings.innerLips) {
            lc.globalCompositeOperation = 'destination-out';
            lc.filter = `blur(${feather}px)`;
            pathRing(lc, f.rings.innerLips, w, h); lc.fill();
            lc.filter = 'none';
        }
        lc.globalCompositeOperation = 'source-over';
        ctx.drawImage(layer, 0, 0);
    });
}

// L3: mắt long lanh — iris contrast + whiten + catchlight (KHÔNG làm to).
function enhanceEyes(canvas, faces, amount) {
    if (amount <= 0) return;
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const k = Math.min(1, amount);
    faces.forEach((f) => {
        [f.rings.leftEye, f.rings.rightEye].forEach((ring) => {
            const bb = ringBBox(ring, w, h);
            const cen = centroid(ring);
            const pad = bb.wPx * 0.3;
            const bx = Math.max(0, bb.x - pad), by = Math.max(0, bb.y - pad);
            const bw = Math.min(w - bx, bb.wPx + pad * 2), bh = Math.min(h - by, bb.hPx + pad * 2);
            if (bw <= 0 || bh <= 0) return;

            // Iris contrast + sáng nhẹ: vẽ lại vùng mắt qua filter, clip đúng viền mắt.
            const tmp = makeCanvas(Math.ceil(bw), Math.ceil(bh));
            const t = tmp.getContext('2d');
            t.filter = `contrast(${1 + 0.35 * k}) brightness(${1 + 0.05 * k}) saturate(1.05)`;
            t.drawImage(canvas, bx, by, bw, bh, 0, 0, bw, bh);
            ctx.save();
            pathRing(ctx, ring, w, h);
            ctx.clip();
            ctx.globalAlpha = 0.9;
            ctx.drawImage(tmp, bx, by);
            // whiten lòng trắng rất nhẹ
            ctx.globalAlpha = 0.12 * k;
            ctx.globalCompositeOperation = 'screen';
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.restore();

            // Catchlight: chấm sáng nhỏ góc trên tròng mắt.
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            softBlob(ctx, cen.x * w + bb.wPx * 0.12, cen.y * h - bb.hPx * 0.16, Math.max(2, bb.wPx * 0.10), '255,255,255', 0.8 * k);
            ctx.restore();
        });
    });
}

// Glow rất nhẹ ở sống mũi (tuỳ chọn, tránh tạo "màn sáng" phủ mặt).
function applyGlow(canvas, faces, amount) {
    if (amount <= 0) return;
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    faces.forEach((f) => {
        const fwp = f.metrics.faceW * w;
        ctx.save();
        pathRing(ctx, f.rings.faceOval, w, h);
        ctx.clip();
        ctx.globalCompositeOperation = 'screen';
        softBlob(ctx, f.points.noseBridge.x * w, f.points.noseBridge.y * h, fwp * 0.13, '255,252,245', 0.18 * amount);
        ctx.restore();
    });
}

// Mask cả vùng mặt (face oval đầy đủ, mép mờ mềm) — dùng giới hạn color grading vào mặt.
function buildFaceRegion(w, h, faces, featherPx) {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.filter = `blur(${featherPx}px)`;
    ctx.fillStyle = '#fff';
    // Co viền mặt vào ~12% để không trùm lên tóc/mai/viền.
    faces.forEach((f) => { pathRing(ctx, insetRing(f.rings.faceOval, 0.88), w, h); ctx.fill(); });
    return c;
}

// L6: color grading — CHỈ áp trong vùng mặt (không lan ra nền).
function applyColorGrade(canvas, color, faces) {
    const sat = color.saturation ?? 1;
    const con = color.contrast ?? 1;
    const bri = color.brightness ?? 1;
    const warmth = color.warmth || 0;
    const pink = color.pinkTint || 0;
    const highlight = color.highlight || 0;
    if (sat === 1 && con === 1 && bri === 1 && warmth === 0 && pink === 0 && highlight === 0) return;

    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');

    // Dựng bản đã grade + overlay trên canvas tạm.
    const tmp = makeCanvas(w, h);
    const t = tmp.getContext('2d');
    t.filter = `saturate(${sat}) contrast(${con}) brightness(${bri})`;
    t.drawImage(canvas, 0, 0);
    t.filter = 'none';

    if (highlight > 0) {
        t.globalCompositeOperation = 'screen';
        t.globalAlpha = Math.min(0.45, highlight);
        t.fillStyle = '#fffaf0';
        t.fillRect(0, 0, w, h);
    }
    if (warmth > 0) {
        t.globalCompositeOperation = 'soft-light';
        t.globalAlpha = Math.min(1, warmth);
        t.fillStyle = '#ffb347';
        t.fillRect(0, 0, w, h);
    }
    if (pink > 0) {
        t.globalCompositeOperation = 'soft-light';
        t.globalAlpha = Math.min(1, pink);
        t.fillStyle = '#ff9ec4';
        t.fillRect(0, 0, w, h);
    }
    t.globalAlpha = 1;
    t.globalCompositeOperation = 'source-over';

    // Giới hạn vào vùng mặt rồi phủ lên ảnh gốc -> nền giữ nguyên.
    if (faces.length) {
        const feather = Math.max(2, avgFaceWpx(faces, w) * 0.02);
        const mask = buildFaceRegion(w, h, faces, feather);
        t.globalCompositeOperation = 'destination-in';
        t.drawImage(mask, 0, 0);
        t.globalCompositeOperation = 'source-over';
    }

    ctx.drawImage(tmp, 0, 0);
}

/**
 * Áp toàn bộ look lên canvas (tại chỗ).
 * look = {
 *   beauty: { retouch, toneRed, toneYellow, brightness, glow },
 *   makeup: { blush, lips, eye, lipstick, lipColor },
 *   color:  { saturation, contrast, brightness, warmth, pinkTint, highlight }
 * }
 */
export function applyLook(canvas, faces, look = {}) {
    const beauty = look.beauty || {};
    const makeup = look.makeup || {};
    const color = look.color || {};

    if (faces.length) {
        processSkin(canvas, faces, beauty);                 // L1 + L2
        applyBlush(canvas, faces, makeup.blush || 0);
        enhanceLips(canvas, faces, makeup.lips || 0);       // L4 (tăng sắc môi gốc)
        applyLipstick(canvas, faces, makeup);               // L4b (tô son có màu, sau khi tăng sắc)
        enhanceEyes(canvas, faces, makeup.eye ?? makeup.eyeBrighten ?? 0); // L3
        applyGlow(canvas, faces, beauty.glow || 0);
    }

    applyColorGrade(canvas, color, faces);                  // L6 (chỉ trong vùng mặt)
}
