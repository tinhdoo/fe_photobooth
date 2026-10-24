// lookStage.js — Beauty pipeline (Canvas 2D), thiết kế để TỰ NHIÊN, không "da nhựa", không "mặt nạ".
//  L1 Skin Retouch   : frequency separation CÓ CHẶN MÉP (giữ nét mày/tóc/viền, chỉ xoá khuyết điểm)
//  L2 Tone Correction: làm ĐỀU màu so với chính da của khuôn mặt đó (không kéo cả mặt lệch tông với cổ/tai)
//  L3 Eye Enhancement: dựa trên MỐNG MẮT — chỉ khử hồng lòng trắng, chỉ tăng nét tròng đen
//  L4 Lip Enhancement: mask môi mềm (chừa răng), tô son GIỮ sắc môi thật của khách
//  L5 Face Sculpting : do engine warp xử lý — không nằm ở đây
//  L6 Color Grading  : áp TOÀN ẢNH (mặt–cổ–tai–nền liền tông), highlight có trọng số theo độ sáng
//
// ĐƠN VỊ QUAN TRỌNG: geometry.js tính khoảng cách bằng distA() = hypot(dx*aspect, dy) nên mọi
// metrics (faceW, irisR...) là đơn vị chuẩn hoá theo CHIỀU CAO ảnh. Muốn ra pixel phải nhân
// với h, KHÔNG phải w. (Nhân nhầm w làm mọi bán kính phình 1.5x trên ảnh ngang 3:2.)
//
// Từ 10/2026 có thêm ĐƯỜNG CARD ĐỒ HOẠ (lookGL.js, xem applyLookGPU) — cùng công thức, nhanh hơn
// nhiều lần; máy không dùng được WebGL thì tự chạy đường canvas bên dưới như trước.

import { getLookGL, setLookGLEnabled } from './lookGL.js';

function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (t) => t * t * (3 - 2 * t);
const centroid = (ring) => {
    const s = ring.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: s.x / ring.length, y: s.y / ring.length };
};
// Co/nở vòng polygon quanh tâm của nó.
const insetRing = (ring, factor) => {
    const c = centroid(ring);
    return ring.map((p) => ({ x: c.x + (p.x - c.x) * factor, y: c.y + (p.y - c.y) * factor }));
};

/** Bề ngang khuôn mặt quy ra PIXEL. faceW là đơn vị theo chiều cao ảnh -> nhân h. */
const faceWpx = (face, h) => face.metrics.faceW * h;
const avgFaceWpx = (faces, h) => (faces.reduce((s, f) => s + f.metrics.faceW, 0) / faces.length) * h;

function pathRing(ctx, ring, w, h, ox = 0, oy = 0) {
    ctx.beginPath();
    ring.forEach((p, i) => {
        const x = p.x * w - ox;
        const y = p.y * h - oy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.closePath();
}

// Ma trận saturate() của CSS (Filter Effects spec), áp lên một điểm ảnh 0..255.
function cssSaturate(r, g, b, s) {
    return [
        (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
        (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
        (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
    ];
}
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Điểm (px) nằm trong vòng landmark (toạ độ chuẩn hoá) — đếm số lần cắt tia ngang. */
function pointInRing(ring, w, h, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i].x * w, yi = ring[i].y * h, xj = ring[j].x * w, yj = ring[j].y * h;
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
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

// Vùng làm việc quanh một ring, đã kẹp trong khung ảnh.
function padBox(bb, pad, w, h) {
    const x = Math.max(0, Math.floor(bb.x - pad));
    const y = Math.max(0, Math.floor(bb.y - pad));
    const bw = Math.min(w - x, Math.ceil(bb.wPx + pad * 2));
    const bh = Math.min(h - y, Math.ceil(bb.hPx + pad * 2));
    return { x, y, w: bw, h: bh };
}

function softBlob(ctx, x, y, r, rgb, alpha) {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${rgb},${alpha})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// ---------------------------------------------------------------------------
// MASK DA — theo polygon khuôn mặt, KHÔNG dùng đốm tròn.
// Đốm tròn cho cường độ không đều (tâm 1.0, thái dương 0.1, góc hàm 0) -> da loang lổ
// đúng hình đốm, đồng thời tràn ra tóc/tai/nền vì không bị cắt theo viền mặt.
// ---------------------------------------------------------------------------
// MỘT canvas cho TẤT CẢ khuôn mặt (không phải mỗi người một canvas cỡ nguyên ảnh — với ảnh
// nhóm 1800x2700 thì mỗi canvas ~19MB, 8 người là ~150MB cấp phát vô ích).
// Hai lượt: (1) phủ vùng mặt mọi người, (2) trừ vùng giữ nét của mọi người.
// Cạnh dài tối đa khi dựng các MASK mềm. Mask chỉ gồm vùng + mép mờ (toàn tần số thấp) nên
// dựng nhỏ rồi phóng to là KHÔNG mất chất lượng, trong khi filter blur() của canvas tốn theo
// SỐ PIXEL: dựng ở 640px thay vì 1800px rẻ hơn ~8 lần, và tiết kiệm này nhân lên theo số người.
const MASK_MAX_EDGE = 640;

function maskScale(w, h) {
    const s = Math.min(1, MASK_MAX_EDGE / Math.max(w, h));
    return { s, mw: Math.max(2, Math.round(w * s)), mh: Math.max(2, Math.round(h * s)) };
}

/** Mask da ở cỡ nhỏ (cạnh dài <= MASK_MAX_EDGE); bên dùng tự phóng (canvas: đúng phần vùng mặt;
 *  card đồ hoạ: nội suy khi lấy mẫu) — mép đã mờ sẵn nên phóng to không lộ. */
function buildSkinMaskSmall(w, h, faces) {
    const { mw, mh } = maskScale(w, h);
    const c = makeCanvas(mw, mh);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    // Toạ độ landmark đều chuẩn hoá 0..1 nên vẽ thẳng ở cỡ nhỏ, không cần quy đổi gì thêm.

    // (1) Nền: vùng mặt từng người, co nhẹ + mép mềm để không ăn vào chân tóc/viền mặt.
    faces.forEach((f) => {
        const fu = faceWpx(f, mh);
        ctx.filter = `blur(${Math.max(1, fu * 0.035)}px)`;
        pathRing(ctx, insetRing(f.rings.faceOval, 0.96), mw, mh);
        ctx.fill();
    });
    ctx.filter = 'none';

    // (2) Trừ các vùng KHÔNG được làm mịn (giữ nét): mắt, lông mày, môi, lỗ mũi.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#fff';
    faces.forEach((f) => {
        const fu = faceWpx(f, mh);
        ctx.filter = `blur(${Math.max(1, fu * 0.012)}px)`;
        const punch = (ring, lineWidth) => {
            if (!ring) return;
            pathRing(ctx, ring, mw, mh);
            ctx.fill();
            if (lineWidth > 0) { ctx.lineWidth = lineWidth; ctx.stroke(); }
        };
        punch(f.rings.leftEye, fu * 0.05);
        punch(f.rings.rightEye, fu * 0.05);
        punch(f.rings.leftBrow, fu * 0.035);
        punch(f.rings.rightBrow, fu * 0.035);
        punch(f.rings.lips, fu * 0.025);
        [f.points.nostrilLeft, f.points.nostrilRight].forEach((p) => {
            if (!p) return;
            ctx.beginPath();
            ctx.ellipse(p.x * mw, p.y * mh, fu * 0.05, fu * 0.035, 0, 0, Math.PI * 2);
            ctx.fill();
        });
    });
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    return c;
}

// ---------------------------------------------------------------------------
// L1 + L2 — retouch + tone, một lượt pixel duy nhất, trọng số theo alpha mask
// (không composite cứng nên không có mép).
// ---------------------------------------------------------------------------
function processSkin(canvas, faces, beauty) {
    const retouch = beauty.retouch ?? beauty.smooth ?? 0;
    const toneR = beauty.toneRed ?? 0;
    const toneY = beauty.toneYellow ?? 0;
    const bright = beauty.brightness ?? 0;
    if ((retouch <= 0 && toneR <= 0 && toneY <= 0 && bright <= 0) || !faces.length) return;

    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');

    const fu = avgFaceWpx(faces, h);
    const rSmall = Math.max(0.6, fu * 0.006); // giữ texture mịn (lỗ chân lông)
    const rLarge = Math.max(2, fu * 0.028);   // xoá khuyết điểm/đốm

    // CHỈ xử lý vùng bao các khuôn mặt (mặt thường chỉ chiếm 10-20% ảnh). Ngoài vùng này mask da = 0
    // nên ảnh vốn không đổi; lề rộng hơn 3 lần bán kính mờ lớn + mép mềm của mask để lớp mờ trong vùng
    // y hệt khi làm mờ cả ảnh. Gốc vùng làm tròn xuống bội số 4 -> lưới lấy mẫu màu da tham chiếu
    // (mỗi 4 px) trùng với bản xử lý cả ảnh trước đây.
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    faces.forEach((f) => {
        const bb = ringBBox(f.rings.faceOval, w, h);
        const pad = rLarge * 3 + faceWpx(f, h) * 0.15 + 4;
        x0 = Math.min(x0, bb.x - pad); y0 = Math.min(y0, bb.y - pad);
        x1 = Math.max(x1, bb.x + bb.wPx + pad); y1 = Math.max(y1, bb.y + bb.hPx + pad);
    });
    const X = Math.max(0, Math.floor(x0 / 4) * 4), Y = Math.max(0, Math.floor(y0 / 4) * 4);
    const RW = Math.min(w, Math.ceil(x1)) - X, RH = Math.min(h, Math.ceil(y1)) - Y;
    if (RW < 2 || RH < 2) return;

    // Mask hợp nhất mọi khuôn mặt (dựng 1 lần cho cả nhóm, ở cỡ nhỏ) rồi phóng đúng phần của vùng.
    const small = buildSkinMaskSmall(w, h, faces);
    const mc = makeCanvas(RW, RH);
    const mctx = mc.getContext('2d');
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = 'high';
    const kx = small.width / w, ky = small.height / h;
    mctx.drawImage(small, X * kx, Y * ky, RW * kx, RH * ky, 0, 0, RW, RH);
    const mask = mctx.getImageData(0, 0, RW, RH).data;

    const o = ctx.getImageData(X, Y, RW, RH);
    const s = blurredRegion(canvas, X, Y, RW, RH, rSmall);
    const l = blurredRegion(canvas, X, Y, RW, RH, rLarge);
    const out = ctx.createImageData(RW, RH);
    const od = o.data, sd = s.data, ld = l.data, qd = out.data;

    // Màu da THAM CHIẾU của chính khuôn mặt này (lấy trên bản low-freq, nơi mask gần đặc).
    // Tone sẽ làm ĐỀU quanh giá trị này thay vì kéo cả mặt lệch đi so với cổ/tai.
    let mR = 0, mG = 0, mB = 0, mN = 0;
    for (let y = 0; y < RH; y += 4) {
        for (let x = 0; x < RW; x += 4) {
            const i = (y * RW + x) * 4;
            if (mask[i + 3] > 230) { mR += ld[i]; mG += ld[i + 1]; mB += ld[i + 2]; mN++; }
        }
    }
    const hasRef = mN > 24;
    if (hasRef) { mR /= mN; mG /= mN; mB /= mN; }
    const mLum = hasRef ? 0.3 * mR + 0.59 * mG + 0.11 * mB : 0;
    const refRG = hasRef ? mR - mG : 0;
    const refY = hasRef ? (mR + mG) / 2 - mB : 0;
    const addB = bright * 12;

    for (let i = 0; i < od.length; i += 4) {
        const a = mask[i + 3] / 255;
        qd[i + 3] = 255;
        if (a <= 0.004) { qd[i] = od[i]; qd[i + 1] = od[i + 1]; qd[i + 2] = od[i + 2]; continue; }

        // --- L1: frequency separation CÓ CHẶN MÉP ---------------------------
        // out = O - k*(S - L). Ở mép tương phản mạnh (chân tóc, mày, gọng kính, viền mặt)
        // |S-L| rất lớn -> trừ thẳng sẽ tạo QUẦNG sáng/tối = dấu hiệu "da photoshop".
        // Vì vậy tắt dần retouch theo năng lượng dải.
        const dS = Math.max(
            Math.abs(sd[i] - ld[i]),
            Math.abs(sd[i + 1] - ld[i + 1]),
            Math.abs(sd[i + 2] - ld[i + 2]),
        );
        const guard = dS <= 20 ? 1 : dS >= 48 ? 0 : (48 - dS) / 28;
        const k = retouch * guard * a;
        let r = od[i] - k * (sd[i] - ld[i]);
        let g = od[i + 1] - k * (sd[i + 1] - ld[i + 1]);
        let b = od[i + 2] - k * (sd[i + 2] - ld[i + 2]);

        // --- L2: tone + sáng, chỉ trên DA ----------------------------------
        // wSkin tắt dần ở chỗ tối hơn hẳn da (tóc mái, lông mi, lỗ mũi lọt trong mask)
        // -> không bị "xám hoá" hay nâng sáng những chỗ đáng lẽ phải tối.
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        const wSkin = hasRef ? clamp01((lum - 0.35 * mLum) / (0.25 * mLum)) : 1;
        const wgt = a * wSkin;

        if (wgt > 0) {
            if (toneR > 0) {
                // Xoá phần ĐỎ DƯ so với da chung (ửng má, cánh mũi, thâm mụn), rồi mới
                // dịch chung một chút -> da đều màu mà tông tổng thể vẫn khớp cổ/tai.
                if (hasRef) {
                    const excessR = (r - g) - refRG * (lum / mLum);
                    if (excessR > 0) r -= excessR * 0.6 * toneR * wgt;
                }
                if (r > g) r -= (r - g) * 0.15 * toneR * wgt;
            }
            if (toneY > 0) {
                if (hasRef) {
                    const excessY = ((r + g) / 2 - b) - refY * (lum / mLum);
                    if (excessY > 0) b += excessY * 0.5 * toneY * wgt;
                }
                const yellow = (r + g) / 2 - b;
                if (yellow > 0) b += yellow * 0.1 * toneY * wgt;
            }
            if (addB) { const d = addB * wgt; r += d; g += d; b += d; }
        }

        qd[i] = clamp8(r);
        qd[i + 1] = clamp8(g);
        qd[i + 2] = clamp8(b);
    }

    ctx.putImageData(out, X, Y);
}

/** Làm mờ một vùng của canvas (ra ImageData cỡ vùng). */
function blurredRegion(srcCanvas, x, y, rw, rh, px) {
    const c = makeCanvas(rw, rh);
    const ctx = c.getContext('2d');
    ctx.filter = `blur(${px}px)`;
    ctx.drawImage(srcCanvas, x, y, rw, rh, 0, 0, rw, rh);
    return ctx.getImageData(0, 0, rw, rh);
}

// ---------------------------------------------------------------------------
// L4 — MÔI: một mask mềm dùng chung cho cả tăng sắc lẫn tô son.
// Mask = viền môi NGOÀI trừ viền môi TRONG -> cười hở răng thì răng/lưỡi không bị đụng.
// ---------------------------------------------------------------------------
function buildLipMask(box, f, w, h, feather) {
    const c = makeCanvas(box.w, box.h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';

    // Mép mềm: blur lan ra CẢ HAI phía viền môi. Phần lan RA NGOÀI chính là vệt son lem lên da
    // quanh miệng. Cách xử lý: NỚI RỘNG polygon trước khi blur, rồi CẮT LẠI đúng viền môi thật.
    //  - Nới rộng bù lại phần alpha bị blur ăn mòn -> son phủ đầy tới sát mép môi (không nới thì
    //    rìa môi chỉ được ~50% -> son nhạt đi thấy rõ).
    //  - Cắt bằng destination-in với polygon KHÔNG blur -> ra ngoài viền môi là sạch tuyệt đối.
    // Vì đã cắt nên nới thoải mái, không sợ lem.
    const lipHalfW = Math.max(1, ringBBox(f.rings.lips, w, h).wPx / 2);
    const grow = 1 + (feather * 1.3) / lipHalfW;
    ctx.filter = `blur(${feather}px)`;
    pathRing(ctx, insetRing(f.rings.lips, grow), w, h, box.x, box.y);
    ctx.fill();
    ctx.filter = 'none';

    ctx.globalCompositeOperation = 'destination-in';
    pathRing(ctx, f.rings.lips, w, h, box.x, box.y);
    ctx.fill();

    // Chừa khoang miệng (răng/lưỡi khi cười hở). Ở đây blur hướng vào trong là đúng — nó chỉ
    // làm mềm rìa trong, không đẩy son ra ngoài.
    if (f.rings.innerLips) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.filter = `blur(${Math.max(1, feather * 0.6)}px)`;
        pathRing(ctx, f.rings.innerLips, w, h, box.x, box.y);
        ctx.fill();
        ctx.filter = 'none';
    }
    ctx.globalCompositeOperation = 'source-over';
    return c;
}

/** Màu + độ bão hoà trung bình của môi thật (để không đè bẹp son khách đang đánh). */
// probe + enhance: đường card đồ hoạ không đọc lại canvas (mỗi lần đọc bắt card đồ hoạ dừng chờ, rất chậm) mà
// lấy ảnh đọc sẵn TRƯỚC khi tăng sắc môi rồi tính lại đúng phép tăng sắc (a) -> cùng kết quả với đọc canvas.
function measureLips(canvas, maskCanvas, box, probe = null, enhance = 0) {
    if (box.w < 2 || box.h < 2) return null;
    const pre = probePixels(probe, box);
    const px = pre || canvas.getContext('2d').getImageData(box.x, box.y, box.w, box.h).data;
    const mk = maskCanvas.getContext('2d').getImageData(0, 0, box.w, box.h).data;
    const ke = pre && enhance > 0 ? Math.min(1, enhance) : 0;
    let r = 0, g = 0, b = 0, sat = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
        if (mk[i + 3] < 128) continue;
        let R = px[i], G = px[i + 1], B = px[i + 2];
        if (ke) {
            const a = mk[i + 3] / 255;
            const br = 1 + 0.04 * ke;
            const t = cssSaturate(R, G, B, 1 + 0.55 * ke).map((v) => clamp255(clamp255(v) * br));
            R += (t[0] - R) * a; G += (t[1] - G) * a; B += (t[2] - B) * a;
        }
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        r += R; g += G; b += B;
        sat += mx > 0 ? (mx - mn) / mx : 0;
        n++;
    }
    if (n < 16) return null;
    return { r: r / n, g: g / n, b: b / n, sat: sat / n };
}

// Toàn bộ xử lý môi làm trong KHUNG NHỎ quanh miệng. Trước đây mỗi người tốn tới 3 canvas cỡ
// nguyên ảnh (mask + lớp tăng sắc + lớp son) -> ảnh nhóm 1800x2700 với 8 người là ~450MB cấp
// phát vô ích. Khung miệng chỉ vài chục nghìn pixel nên chi phí gần như bằng 0.
function applyLips(canvas, faces, makeup, probe = null) {
    const enhance = makeup.lips || 0;
    const stick = makeup.lipstick || 0;
    if (enhance <= 0 && stick <= 0) return;
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');

    faces.forEach((f) => {
        const fu = faceWpx(f, h);
        const feather = Math.max(1.5, fu * 0.012);
        const bb = ringBBox(f.rings.lips, w, h);
        if (bb.wPx < 6) return;
        const box = padBox(bb, feather * 2 + bb.wPx * 0.15, w, h);
        if (box.w < 4 || box.h < 4) return;
        const mask = buildLipMask(box, f, w, h, feather);

        // (a) TÔN MÀU MÔI THẬT — không thay màu, chỉ làm sắc môi vốn có tươi lên.
        // Qua mask mềm nên không tạo bậc ở rìa, không chạm răng, không lem ra da.
        // Hệ số 0.55: mức 0.3 cũ chỉ ra saturate(1.045) ở Natural, tức mắt thường không thấy gì.
        // Thêm chút brightness để môi trông có sức sống thay vì chỉ đậm màu hơn.
        if (enhance > 0) {
            const k = Math.min(1, enhance);
            const layer = makeCanvas(box.w, box.h);
            const lc = layer.getContext('2d');
            lc.filter = `saturate(${1 + 0.55 * k}) brightness(${1 + 0.04 * k})`;
            lc.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
            lc.filter = 'none';
            lc.globalCompositeOperation = 'destination-in';
            lc.drawImage(mask, 0, 0);
            ctx.drawImage(layer, box.x, box.y);
        }

        // (b) Tô son — GIỮ sắc môi của khách: chỉ kéo nửa đường về màu preset, và nếu
        // khách đã đánh son đậm (bão hoà cao) thì gần như không đụng vào.
        if (stick > 0) {
            const measured = measureLips(canvas, mask, box, probe, enhance);
            const target = (makeup.lipColor || '217,139,139').split(',').map(Number);
            let k = Math.min(1, stick);
            let rgb = target;
            if (measured) {
                // Chỉ hãm khi khách ĐÃ đánh son RÕ (bão hoà > 0.5). Môi mộc của người Việt thường
                // ở 0.28–0.40 nên trước đây ngưỡng 0.4 làm son bị hãm oan.
                k *= clamp01(1 - (measured.sat - 0.5) / 0.3) * 0.7 + 0.3;
                // Kéo 85% về màu preset: 'color' blend chỉ kéo được TỚI độ bão hoà của màu
                // đích, nên trộn ít thì son không bao giờ lên được. Vẫn giữ chút sắc môi thật.
                rgb = [
                    Math.round(measured.r + (target[0] - measured.r) * 0.85),
                    Math.round(measured.g + (target[1] - measured.g) * 0.85),
                    Math.round(measured.b + (target[2] - measured.b) * 0.85),
                ];
            }
            const layer = makeCanvas(box.w, box.h);
            const lc = layer.getContext('2d');
            lc.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
            lc.globalCompositeOperation = 'color';      // giữ sáng/tối và nếp môi, chỉ đổi sắc
            lc.globalAlpha = 0.85 * k;
            lc.fillStyle = `rgb(${rgb})`;
            lc.fillRect(0, 0, box.w, box.h);
            lc.globalCompositeOperation = 'soft-light'; // thêm chút chiều sâu
            lc.globalAlpha = 0.25 * k;
            lc.fillRect(0, 0, box.w, box.h);
            lc.globalAlpha = 1;
            lc.globalCompositeOperation = 'destination-in';
            lc.drawImage(mask, 0, 0);
            lc.globalCompositeOperation = 'source-over';
            ctx.drawImage(layer, box.x, box.y);
        }
    });
}

// Má hồng: đặt ở táo má, clip trong mặt, chừa mắt.
function applyBlush(canvas, faces, makeup) {
    const { width: w, height: h } = canvas;
    const layer = buildBlushLayer(w, h, faces, makeup);
    if (!layer) return;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(layer, 0, 0, w, h);
    ctx.restore();
}

/** Lớp má hồng ở cỡ nhỏ (null nếu không có). Bản canvas phủ soft-light; bản card đồ hoạ trộn trong shader. */
function buildBlushLayer(w, h, faces, makeup) {
    const amount = makeup.blush || 0;
    if (amount <= 0 || !faces.length) return null;
    const rgb = makeup.blushColor || '255,135,160';

    // MỘT lớp chung cho cả nhóm, dựng ở ĐỘ PHÂN GIẢI THẤP (má hồng là mảng mờ, phóng to không
    // lộ). Trước đây mỗi người một canvas cỡ nguyên ảnh + blur toàn khung.
    const { mw, mh } = maskScale(w, h);
    const layer = makeCanvas(mw, mh);
    const lc = layer.getContext('2d');
    faces.forEach((f) => {
        const fu = faceWpx(f, mh);
        const cheekL = lerp(f.points.cheekLeft, f.points.leftEye, 0.2);
        const cheekR = lerp(f.points.cheekRight, f.points.rightEye, 0.2);
        [cheekL, cheekR].forEach((c) => softBlob(lc, c.x * mw, c.y * mh, fu * 0.22, rgb, 0.5 * amount));
    });
    // Chừa mắt để má hồng không lem vào lòng trắng/quầng mắt.
    lc.globalCompositeOperation = 'destination-out';
    faces.forEach((f) => {
        lc.filter = `blur(${Math.max(1, faceWpx(f, mh) * 0.02)}px)`;
        pathRing(lc, f.rings.leftEye, mw, mh); lc.fill();
        pathRing(lc, f.rings.rightEye, mw, mh); lc.fill();
    });
    lc.filter = 'none';
    // Chỉ giữ phần nằm trong khuôn mặt (không lem ra tóc/nền). Phải dựng mask HỢP NHẤT rồi cắt
    // MỘT lần — gọi destination-in nhiều lần sẽ lấy GIAO của các khuôn mặt (= rỗng).
    const oval = makeCanvas(mw, mh);
    const oc = oval.getContext('2d');
    oc.fillStyle = '#fff';
    faces.forEach((f) => { pathRing(oc, insetRing(f.rings.faceOval, 0.98), mw, mh); oc.fill(); });
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(oval, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    return layer;
}

// ---------------------------------------------------------------------------
// L3 — MẮT: dựa trên mống mắt. Khử hồng lòng trắng (không bôi trắng), tăng nét tròng đen,
// và CHỈ thêm catchlight khi ảnh chưa có sẵn (ring light thường đã tạo rồi).
// ---------------------------------------------------------------------------
function enhanceEyes(canvas, faces, amount, probe = null) {
    if (amount <= 0) return;
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const k = Math.min(1, amount);

    faces.forEach((f) => {
        const pairs = [
            [f.rings.leftEye, f.points.irisLeft, f.metrics.irisLeftR],
            [f.rings.rightEye, f.points.irisRight, f.metrics.irisRightR],
        ];
        pairs.forEach(([ring, iris, irisR]) => {
            const bb = ringBBox(ring, w, h);
            // Bỏ qua mắt quá nhỏ (ảnh nhóm, người ở xa) hoặc đang híp/nhắm.
            if (bb.wPx < 10 || bb.hPx < bb.wPx * 0.18) return;
            const box = padBox(bb, Math.max(3, bb.wPx * 0.35), w, h);
            if (box.w < 4 || box.h < 4) return;

            const cen = centroid(ring);
            const cx = iris ? iris.x * w : cen.x * w;
            const cy = iris ? iris.y * h : cen.y * h;
            const rIris = irisR ? irisR * h : bb.wPx * 0.22;
            const eyeFeather = Math.max(1, bb.wPx * 0.02);
            // Đọc vùng tròng đen TRƯỚC khi chỉnh (đường card đồ hoạ: lấy từ vùng đọc sẵn, không đọc lại canvas).
            const catchlight = hasCatchlight(ctx, probe, ring, w, h, cx, cy, rIris, k);

            // Mask mí (mềm) trong toạ độ box.
            const mEye = makeCanvas(box.w, box.h);
            const me = mEye.getContext('2d');
            me.fillStyle = '#fff';
            me.filter = `blur(${eyeFeather}px)`;
            pathRing(me, ring, w, h, box.x, box.y);
            me.fill();
            me.filter = 'none';

            // (a) LÒNG TRẮNG: giảm bão hoà để hết ánh hồng/gân máu + sáng rất nhẹ.
            //     Dùng desaturate thay vì phủ trắng -> không làm đồng tử xám đục.
            const sclera = makeCanvas(box.w, box.h);
            const sc = sclera.getContext('2d');
            sc.filter = `saturate(${1 - 0.45 * k}) brightness(${1 + 0.05 * k})`;
            sc.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
            sc.filter = 'none';
            sc.globalCompositeOperation = 'destination-in';
            sc.drawImage(mEye, 0, 0);
            sc.globalCompositeOperation = 'destination-out';
            sc.filter = `blur(${Math.max(1, rIris * 0.15)}px)`;
            sc.beginPath();
            sc.arc(cx - box.x, cy - box.y, rIris * 1.1, 0, Math.PI * 2);
            sc.fill();
            sc.filter = 'none';
            ctx.drawImage(sclera, box.x, box.y);

            // (b) TRÒNG ĐEN: tăng tương phản + bù sáng (tròng nâu sẫm không bị tối thêm).
            const irisLayer = makeCanvas(box.w, box.h);
            const ic = irisLayer.getContext('2d');
            ic.filter = `contrast(${1 + 0.25 * k}) brightness(${1 + 0.08 * k}) saturate(${1 + 0.15 * k})`;
            ic.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
            ic.filter = 'none';
            ic.globalCompositeOperation = 'destination-in';
            ic.filter = `blur(${Math.max(1, rIris * 0.12)}px)`;
            ic.beginPath();
            ic.arc(cx - box.x, cy - box.y, rIris, 0, Math.PI * 2);
            ic.fill();
            ic.filter = 'none';
            ic.globalCompositeOperation = 'destination-in'; // vẫn phải nằm trong khe mí
            ic.drawImage(mEye, 0, 0);
            ic.globalCompositeOperation = 'source-over';
            ctx.drawImage(irisLayer, box.x, box.y);

            // (c) CATCHLIGHT: chỉ thêm nếu tròng đen chưa có điểm sáng thật.
            if (catchlight !== false) return; // đã có sẵn (hoặc không đo được) -> không vẽ thêm

            ctx.save();
            pathRing(ctx, ring, w, h);
            ctx.clip();
            ctx.beginPath();
            ctx.arc(cx, cy, rIris, 0, Math.PI * 2);
            ctx.clip();
            ctx.globalCompositeOperation = 'screen';
            softBlob(ctx, cx - rIris * 0.35, cy - rIris * 0.35, rIris * 0.28, '255,255,255', 0.45 * k);
            ctx.restore();
        });
    });
}

/**
 * Tròng đen đã có điểm sáng thật chưa? Xét các điểm trong đĩa tròng đen VÀ trong khe mí, sau khi quy đổi qua
 * đúng lớp tăng nét tròng đen (contrast -> brightness -> saturate). Trước đây xét cả hình vuông quanh tròng
 * đen SAU khi chỉnh, nên lòng trắng / mí sáng ở bốn góc cũng bị tính là điểm sáng.
 * Trả true / false, hoặc null nếu vùng quá nhỏ.
 */
function hasCatchlight(ctx, probe, ring, w, h, cx, cy, rIris, k) {
    const r0 = Math.max(1, Math.round(rIris));
    const sx = Math.max(0, Math.round(cx - r0));
    const sy = Math.max(0, Math.round(cy - r0));
    const sw = Math.min(w - sx, r0 * 2);
    const sh = Math.min(h - sy, r0 * 2);
    if (sw < 2 || sh < 2) return null;
    const px = probePixels(probe, { x: sx, y: sy, w: sw, h: sh }) || ctx.getImageData(sx, sy, sw, sh).data;
    const c = 1 + 0.25 * k, br = 1 + 0.08 * k, sat = 1 + 0.15 * k;
    let bright = 0, total = 0;
    for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
            const X = sx + x + 0.5, Y = sy + y + 0.5;
            if ((X - cx) ** 2 + (Y - cy) ** 2 > rIris * rIris || !pointInRing(ring, w, h, X, Y)) continue;
            const i = (y * sw + x) * 4;
            const t = [px[i], px[i + 1], px[i + 2]].map((v) => clamp255(clamp255((v - 127.5) * c + 127.5) * br));
            const o = cssSaturate(t[0], t[1], t[2], sat).map(clamp255);
            total++;
            if (Math.min(o[0], o[1], o[2]) > 225) bright++;
        }
    }
    if (!total) return null;
    return bright / total > 0.004;
}

// ---------------------------------------------------------------------------
// Công cụ bước Chỉnh ảnh: che quầng thâm, trắng răng, đậm mày, xoá mụn. Đều làm trong khung nhỏ quanh
// vùng cần sửa bằng canvas 2D (không đọc lại ảnh từ card đồ hoạ, trừ trắng răng dùng vùng đọc sẵn).
// ---------------------------------------------------------------------------

// Vẽ `canvas` (vùng box) qua bộ lọc CSS, giữ lại theo mask (canvas cùng cỡ box), phủ lên ảnh.
function filteredPatch(ctx, canvas, box, filter, mask, alpha = 1) {
    const layer = makeCanvas(box.w, box.h);
    const lc = layer.getContext('2d');
    lc.filter = filter;
    lc.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    lc.filter = 'none';
    lc.globalCompositeOperation = 'destination-in';
    lc.drawImage(mask, 0, 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(layer, box.x, box.y);
    ctx.restore();
}

// Mask đa giác (toạ độ px của ảnh) có mép mềm, trong khung box.
function polyMask(box, pts, feather) {
    const m = makeCanvas(box.w, box.h);
    const mc = m.getContext('2d');
    mc.filter = `blur(${feather}px)`;
    mc.fillStyle = '#fff';
    mc.beginPath();
    pts.forEach((p, i) => (i ? mc.lineTo(p.x - box.x, p.y - box.y) : mc.moveTo(p.x - box.x, p.y - box.y)));
    mc.closePath();
    mc.fill();
    return m;
}

function polyBox(pts, pad, w, h) {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return padBox({ x: x0, y: y0, wPx: Math.max(...xs) - x0, hPx: Math.max(...ys) - y0 }, pad, w, h);
}

// QUẦNG THÂM: dải lưỡi liềm dưới mí dưới (chừa chân mi), nâng sáng + bớt ánh tím xanh.
function applyDarkCircles(canvas, faces, amount) {
    if (amount <= 0) return;
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const k = Math.min(1, amount);
    faces.forEach((f) => {
        [f.rings.leftEye, f.rings.rightEye].forEach((ring) => {
            const ew = ringBBox(ring, w, h).wPx;
            if (ew < 10) return;
            // Vòng mắt geometry.js: [0] khoé ngoài, 1..7 mí trên, [8] khoé trong, 9..15 mí dưới.
            const lower = [...ring.slice(8), ring[0]].map((p) => ({ x: p.x * w, y: p.y * h }));
            const a = lower[0], b = lower[lower.length - 1];
            let nx = -(b.y - a.y), ny = b.x - a.x;
            const nl = Math.hypot(nx, ny) || 1;
            nx /= nl; ny /= nl;
            if (ny < 0) { nx = -nx; ny = -ny; } // luôn hướng xuống má
            const n = lower.length;
            const at = (o0, o1) => lower.map((p, i) => {
                const o = ew * (o0 + o1 * Math.sin((Math.PI * i) / (n - 1)));
                return { x: p.x + nx * o, y: p.y + ny * o };
            });
            const pts = [...at(0.05, 0.04), ...at(0.12, 0.4).reverse()];
            const feather = Math.max(1.5, ew * 0.09);
            const box = polyBox(pts, feather * 2, w, h);
            if (box.w < 4 || box.h < 4) return;
            filteredPatch(ctx, canvas, box, `brightness(${1 + 0.2 * k}) saturate(${1 - 0.3 * k})`, polyMask(box, pts, feather), 0.85);
        });
    });
}

// TRẮNG RĂNG: chỉ điểm sáng + ít màu trong khoang miệng (răng), không đụng lưỡi / lợi / môi. Đọc điểm ảnh
// từ vùng đọc sẵn nếu có (đường card đồ hoạ), không thì đọc canvas (vùng miệng rất nhỏ).
function whitenTeeth(canvas, faces, amount, probe = null) {
    if (amount <= 0) return;
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const k = Math.min(1, amount);
    faces.forEach((f) => {
        const pts = f.rings.innerLips.map((p) => ({ x: p.x * w, y: p.y * h }));
        const bb = ringBBox(f.rings.innerLips, w, h);
        if (bb.wPx < 8 || bb.hPx < bb.wPx * 0.08) return; // miệng khép -> không thấy răng
        const box = polyBox(pts, 2, w, h);
        if (box.w < 4 || box.h < 4) return;
        const mk = polyMask(box, pts, 1).getContext('2d').getImageData(0, 0, box.w, box.h).data;
        const px = probePixels(probe, box) || ctx.getImageData(box.x, box.y, box.w, box.h).data;
        const out = new ImageData(box.w, box.h);
        const od = out.data;
        const lift = 1 + 0.1 * k;
        for (let i = 0; i < px.length; i += 4) {
            const a = mk[i + 3] / 255;
            if (a <= 0) continue;
            const r = px[i], g = px[i + 1], b = px[i + 2];
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            const v = mx / 255, s = mx ? (mx - mn) / mx : 0;
            const wt = a * clamp01((v - 0.3) / 0.25) * clamp01(1 - s / 0.5);
            if (wt <= 0.01) continue;
            const nb = b + ((r + g) / 2 - b) * 0.75 * k; // bớt vàng
            od[i] = clamp255(r * lift);
            od[i + 1] = clamp255(g * lift);
            od[i + 2] = clamp255(nb * lift);
            od[i + 3] = Math.round(255 * wt);
        }
        const layer = makeCanvas(box.w, box.h);
        layer.getContext('2d').putImageData(out, 0, 0);
        ctx.drawImage(layer, box.x, box.y);
    });
}

const lumAt = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

// Độ sáng da tham chiếu của một mặt: trung bình hai mảng nhỏ ở má (vùng đọc sẵn nếu có).
function cheekLum(ctx, f, w, h, probe) {
    const r = Math.max(2, Math.round(faceWpx(f, h) * 0.04));
    let s = 0, n = 0;
    [f.points.cheekLeft, f.points.cheekRight].forEach((p) => {
        const box = { x: Math.round(p.x * w) - r, y: Math.round(p.y * h) - r, w: r * 2, h: r * 2 };
        if (box.x < 0 || box.y < 0 || box.x + box.w > w || box.y + box.h > h) return;
        const d = probePixels(probe, box) || ctx.getImageData(box.x, box.y, box.w, box.h).data;
        for (let i = 0; i < d.length; i += 4) { s += lumAt(d, i); n += 1; }
    });
    return n ? s / n : 0;
}

// ĐẬM MÀY kiểu kẻ chì: trong dáng mày, tô các khe da SÁNG bằng màu chính sợi mày; điểm vốn đã tối (sợi mày, tóc)
// giữ nguyên. Nhờ vậy mày bị tóc mái che thì gần như không đổi — bản cũ tối cả dải -> hiện vệt hình lông mày trên
// tóc mái (ảnh thật 23/10).
function applyBrows(canvas, faces, amount, probe = null) {
    if (amount <= 0) return;
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const k = Math.min(1, amount);
    faces.forEach((f) => {
        const skin = cheekLum(ctx, f, w, h, probe);
        if (skin < 40) return; // không đo được da (quá tối / ngoài ảnh)
        [f.rings.leftBrow, f.rings.rightBrow].forEach((ring) => {
            const bw = ringBBox(ring, w, h).wPx;
            if (bw < 10) return;
            const pts = ring.map((p) => ({ x: p.x * w, y: p.y * h }));
            const feather = Math.max(1, bw * 0.04);
            const box = polyBox(pts, feather * 3, w, h);
            if (box.w < 4 || box.h < 4) return;
            const mk = polyMask(box, pts, feather).getContext('2d').getImageData(0, 0, box.w, box.h).data;
            const px = probePixels(probe, box) || ctx.getImageData(box.x, box.y, box.w, box.h).data;
            // Màu sợi mày = trung bình các điểm tối trong dáng mày.
            const hair = [0, 0, 0];
            let nh = 0, nm = 0;
            for (let i = 0; i < px.length; i += 4) {
                if (mk[i + 3] < 128) continue;
                nm += 1;
                if (lumAt(px, i) < 0.6 * skin) { hair[0] += px[i]; hair[1] += px[i + 1]; hair[2] += px[i + 2]; nh += 1; }
            }
            if (nh < Math.max(4, nm * 0.05)) return; // không thấy sợi mày -> không bịa ra
            const [hr, hg, hb] = hair.map((v) => v / nh);
            const out = new ImageData(box.w, box.h);
            const od = out.data;
            for (let i = 0; i < px.length; i += 4) {
                const a = mk[i + 3] / 255;
                if (a <= 0) continue;
                const t = clamp01((lumAt(px, i) - 0.6 * skin) / (0.3 * skin)); // 0 = đã tối, 1 = da
                const wt = a * t * 0.75 * k;
                if (wt <= 0.01) continue;
                od[i] = hr; od[i + 1] = hg; od[i + 2] = hb;
                od[i + 3] = Math.round(255 * wt);
            }
            const layer = makeCanvas(box.w, box.h);
            layer.getContext('2d').putImageData(out, 0, 0);
            ctx.drawImage(layer, box.x, box.y);
        });
    });
}

/**
 * XOÁ MỤN: mỗi chấm { x, y, r } (x, y chuẩn hoá; r theo chiều cao ảnh) được đắp bằng trung bình 4 mảng da
 * ngay cạnh (trái / phải / trên / dưới, cách 1,6 bán kính) — giữ vân da thật — rồi bù sáng cho khớp vành da
 * ngay quanh chấm (không bù thì chấm trên đỉnh sáng của má bị vá tối hơn ~15/255, đo 23/10), qua mặt nạ tròn
 * mép mềm. Chạy TRƯỚC các bước làm đẹp (trên canvas 2D, chưa qua card đồ hoạ) để da quanh chỗ sửa được làm
 * mịn chung.
 */
export function healSpots(canvas, spots) {
    if (!Array.isArray(spots) || !spots.length) return;
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    spots.forEach((s) => {
        // Chấm hỏng (NaN / ngoài ảnh) thì bỏ qua — không được làm hỏng cả ảnh in.
        if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y) || s.x < 0 || s.x > 1 || s.y < 0 || s.y > 1) return;
        const r = Math.max(2, (Number.isFinite(s.r) && s.r > 0 ? Math.min(s.r, 0.2) : 0.01) * h);
        const R = Math.ceil(r * 1.3), size = R * 2, off = r * 1.6;
        const x0 = Math.round(s.x * w) - R, y0 = Math.round(s.y * h) - R;
        const patch = makeCanvas(size, size);
        const pc = patch.getContext('2d');
        [[off, 0], [-off, 0], [0, off], [0, -off]].forEach(([dx, dy], i) => {
            pc.globalAlpha = 1 / (i + 1); // trung bình cộng dồn
            pc.drawImage(canvas, x0 + dx, y0 + dy, size, size, 0, 0, size, size);
        });
        pc.globalAlpha = 1;
        // Bù sáng: trung bình vành r..R của ảnh (da thật quanh nốt) trừ trung bình cùng vành của mảng đắp.
        // Chép vùng nhỏ ra canvas riêng rồi mới đọc: getImageData thẳng trên ảnh lớn làm Chrome chuyển cả canvas
        // sang CPU -> các bước làm đẹp sau chậm thêm ~2,4 s ở ảnh 6000 px (đo 23/10).
        const near = makeCanvas(size, size);
        near.getContext('2d').drawImage(canvas, x0, y0, size, size, 0, 0, size, size);
        const src = near.getContext('2d').getImageData(0, 0, size, size).data;
        const pimg = pc.getImageData(0, 0, size, size);
        const pd = pimg.data;
        const sum = [0, 0, 0, 0, 0, 0];
        let n = 0;
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const d = Math.hypot(x + 0.5 - R, y + 0.5 - R);
                const i = (y * size + x) * 4;
                if (d < r || d > R || src[i + 3] < 255 || pd[i + 3] < 255) continue;
                for (let k = 0; k < 3; k += 1) { sum[k] += src[i + k]; sum[3 + k] += pd[i + k]; }
                n += 1;
            }
        }
        if (n >= 8) {
            const diff = [0, 1, 2].map((k) => (sum[k] - sum[3 + k]) / n);
            for (let i = 0; i < pd.length; i += 4) {
                pd[i] = clamp255(pd[i] + diff[0]);
                pd[i + 1] = clamp255(pd[i + 1] + diff[1]);
                pd[i + 2] = clamp255(pd[i + 2] + diff[2]);
            }
            pc.putImageData(pimg, 0, 0);
        }
        pc.globalCompositeOperation = 'destination-in';
        const g = pc.createRadialGradient(R, R, 0, R, R, R);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.6, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        pc.fillStyle = g;
        pc.fillRect(0, 0, size, size);
        ctx.drawImage(patch, x0, y0);
    });
}

// Glow rất nhẹ ở sống mũi (điểm bóng "glass skin"), clip trong mặt.
function applyGlow(canvas, faces, amount) {
    if (amount <= 0) return;
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    faces.forEach((f) => {
        const fu = faceWpx(f, h);
        ctx.save();
        pathRing(ctx, insetRing(f.rings.faceOval, 0.96), w, h);
        ctx.clip();
        ctx.globalCompositeOperation = 'screen';
        softBlob(ctx, f.points.noseBridge.x * w, f.points.noseBridge.y * h, fu * 0.13, '255,252,245', 0.18 * amount);
        ctx.restore();
    });
}

// Nâng sáng CÓ TRỌNG SỐ theo độ sáng: chỉ chỗ vốn đã sáng mới bắt sáng thêm.
// (Phủ 'screen' phẳng như trước nâng bóng tối gấp 5 lần vùng sáng -> mặt bị "phủ sương", mất khối.)
function applyHighlight(canvas, amount) {
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const im = ctx.getImageData(0, 0, w, h);
    const d = im.data;
    const gain = Math.min(0.5, amount) * 255 * 1.4;
    for (let i = 0; i < d.length; i += 4) {
        const L = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        if (L <= 0.55) continue;
        const wgt = smoothstep(clamp01((L - 0.55) / 0.3)) * (1 - L);
        const lift = gain * wgt;
        d[i] = clamp8(d[i] + lift);
        d[i + 1] = clamp8(d[i + 1] + lift * 0.98);
        d[i + 2] = clamp8(d[i + 2] + lift * 0.94);
    }
    ctx.putImageData(im, 0, 0);
}

// ---------------------------------------------------------------------------
// L6 — Color grading: áp TOÀN ẢNH.
// Trước đây grade bị cắt trong viền mặt (co 0.88) nên mặt lệch tông với cổ/tai/nền và
// lộ đường viền ngay giữa vùng da = cảm giác "đeo mặt nạ". Giá trị đều rất nhẹ (≤4%)
// nên áp toàn ảnh trông liền và tự nhiên hơn hẳn.
// ---------------------------------------------------------------------------
/**
 * Cân bằng trắng TOÀN ẢNH bằng cách nhân hệ số kênh R và B (giữ G làm mốc nên độ sáng tổng
 * thể không đổi). Đây là cách chỉnh nhiệt độ màu đúng chuẩn.
 *   warmth < 0  -> LẠNH hơn: bớt đỏ, thêm xanh dương  => da bớt vàng, "trắng" hơn
 *   warmth > 0  -> ẤM hơn
 * Trước đây "ấm" được làm bằng cách phủ lớp cam soft-light lên toàn ảnh — vừa không khử được
 * ám vàng sẵn có của đèn ring light, vừa làm ảnh vàng THÊM (đo được: R-B tăng 1..4 mức).
 */
function applyWhiteBalance(canvas, warmth) {
    const k = Math.max(-1, Math.min(1, warmth));
    if (!k) return;
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const im = ctx.getImageData(0, 0, w, h);
    const d = im.data;
    const kr = 1 + k * 0.18;
    const kb = 1 - k * 0.18;
    for (let i = 0; i < d.length; i += 4) {
        d[i] = clamp8(d[i] * kr);
        d[i + 2] = clamp8(d[i + 2] * kb);
    }
    ctx.putImageData(im, 0, 0);
}

function applyColorGrade(canvas, color) {
    const sat = color.saturation ?? 1;
    const con = color.contrast ?? 1;
    const bri = color.brightness ?? 1;
    const warmth = color.warmth || 0;
    const pink = color.pinkTint || 0;
    const highlight = color.highlight || 0;
    if (sat === 1 && con === 1 && bri === 1 && warmth === 0 && pink === 0 && highlight === 0) return;

    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');

    if (sat !== 1 || con !== 1 || bri !== 1 || pink > 0) {
        const tmp = makeCanvas(w, h);
        const t = tmp.getContext('2d');
        t.filter = `saturate(${sat}) contrast(${con}) brightness(${bri})`;
        t.drawImage(canvas, 0, 0);
        t.filter = 'none';
        if (pink > 0) {
            t.globalCompositeOperation = 'soft-light';
            t.globalAlpha = Math.min(1, pink);
            t.fillStyle = '#ff9ec4';
            t.fillRect(0, 0, w, h);
        }
        t.globalAlpha = 1;
        t.globalCompositeOperation = 'source-over';
        ctx.drawImage(tmp, 0, 0);
    }

    if (warmth && highlight > 0) applyWhiteBalanceAndHighlight(canvas, warmth, highlight);
    else if (warmth) applyWhiteBalance(canvas, warmth);
    else if (highlight > 0) applyHighlight(canvas, highlight);
}

// Cân bằng trắng rồi highlight trong MỘT lần đọc/ghi cả ảnh (mỗi lần đọc/ghi ảnh lớn tốn hàng chục ms).
// Giá trị sau cân bằng trắng làm tròn về số nguyên như khi ghi vào ImageData giữa hai bước trước đây.
function applyWhiteBalanceAndHighlight(canvas, warmth, amount) {
    const k = Math.max(-1, Math.min(1, warmth));
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const im = ctx.getImageData(0, 0, w, h);
    const d = im.data;
    const kr = 1 + k * 0.18;
    const kb = 1 - k * 0.18;
    const gain = Math.min(0.5, amount) * 255 * 1.4;
    for (let i = 0; i < d.length; i += 4) {
        const r = Math.round(clamp8(d[i] * kr));
        const g = d[i + 1];
        const b = Math.round(clamp8(d[i + 2] * kb));
        const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (L <= 0.55) { d[i] = r; d[i + 2] = b; continue; }
        const lift = gain * smoothstep(clamp01((L - 0.55) / 0.3)) * (1 - L);
        d[i] = clamp8(r + lift);
        d[i + 1] = clamp8(g + lift * 0.98);
        d[i + 2] = clamp8(b + lift * 0.94);
    }
    ctx.putImageData(im, 0, 0);
}

// ---------------------------------------------------------------------------
// ĐƯỜNG CARD ĐỒ HOẠ (lookGL.js) — cùng công thức, nhưng các phép TOÀN ẢNH (mịn da, má hồng, chỉnh
// màu) chạy trên card đồ hoạ và cả ảnh chỉ bị đọc về CPU MỘT lần: vùng quanh các khuôn mặt, ngay
// từ đầu (màu da tham chiếu, đo màu môi, dò điểm sáng trong mắt đều lấy ở đó).
// ---------------------------------------------------------------------------

/** Đọc một lần vùng bao mọi khuôn mặt (ảnh gốc, trước khi chỉnh). */
function readFaceRegion(canvas, faces) {
    const { width: w, height: h } = canvas;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    faces.forEach((f) => {
        const bb = ringBBox(f.rings.faceOval, w, h);
        const pad = faceWpx(f, h) * 0.25;
        x0 = Math.min(x0, bb.x - pad); y0 = Math.min(y0, bb.y - pad);
        x1 = Math.max(x1, bb.x + bb.wPx + pad); y1 = Math.max(y1, bb.y + bb.hPx + pad);
    });
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(w, Math.ceil(x1)); y1 = Math.min(h, Math.ceil(y1));
    if (x1 - x0 < 2 || y1 - y0 < 2) return null;
    const data = canvas.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, data };
}

/** Cắt một khung từ vùng đã đọc; null nếu không có vùng hoặc khung không nằm trọn trong vùng. */
function probePixels(probe, box) {
    if (!probe) return null;
    const bx = Math.round(box.x), by = Math.round(box.y);
    if (bx < probe.x || by < probe.y || bx + box.w > probe.x + probe.w || by + box.h > probe.y + probe.h) return null;
    const out = new Uint8ClampedArray(box.w * box.h * 4);
    for (let r = 0; r < box.h; r++) {
        const s = ((by - probe.y + r) * probe.w + (bx - probe.x)) * 4;
        out.set(probe.data.subarray(s, s + box.w * 4), r * box.w * 4);
    }
    return out;
}

/** Màu da tham chiếu (như processSkin): trung bình các điểm nằm sâu trong mask da, lấy mỗi 4 px. */
function skinReference(probe, maskSmall, w, h) {
    if (!probe) return null;
    const mw = maskSmall.width, mh = maskSmall.height;
    const m = maskSmall.getContext('2d').getImageData(0, 0, mw, mh).data;
    let mR = 0, mG = 0, mB = 0, mN = 0;
    const ys = Math.ceil(probe.y / 4) * 4, xs = Math.ceil(probe.x / 4) * 4;
    for (let y = ys; y < probe.y + probe.h; y += 4) {
        const my = Math.min(mh - 1, Math.floor((y + 0.5) * mh / h));
        for (let x = xs; x < probe.x + probe.w; x += 4) {
            const mx = Math.min(mw - 1, Math.floor((x + 0.5) * mw / w));
            if (m[(my * mw + mx) * 4 + 3] <= 230) continue;
            const i = ((y - probe.y) * probe.w + (x - probe.x)) * 4;
            mR += probe.data[i]; mG += probe.data[i + 1]; mB += probe.data[i + 2]; mN++;
        }
    }
    if (mN <= 24) return null;
    mR /= mN; mG /= mN; mB /= mN;
    return { mLum: 0.3 * mR + 0.59 * mG + 0.11 * mB, refRG: mR - mG, refY: (mR + mG) / 2 - mB };
}

/** Tham số chỉnh màu cho shader (null = không đổi gì), cùng điều kiện với applyColorGrade. */
function colorParams(color) {
    // Giá trị hỏng (NaN, âm) coi như không chỉnh — đường canvas cũng bỏ qua cả chuỗi filter khi gặp chúng.
    const num = (v, d, min = -Infinity) => (Number.isFinite(v) && v >= min ? v : d);
    const sat = num(color.saturation, 1, 0);
    const con = num(color.contrast, 1, 0);
    const bri = num(color.brightness, 1, 0);
    const warmth = num(color.warmth, 0);
    const pink = num(color.pinkTint, 0);
    const highlight = num(color.highlight, 0);
    if (sat === 1 && con === 1 && bri === 1 && warmth === 0 && pink === 0 && highlight === 0) return null;
    const k = Math.max(-1, Math.min(1, warmth));
    return {
        filterOn: sat !== 1 || con !== 1 || bri !== 1 || pink > 0,
        sat, con, bri, pink: Math.min(1, Math.max(0, pink)),
        kr: 1 + k * 0.18, kb: 1 - k * 0.18,
        gain: highlight > 0 ? Math.min(0.5, highlight) * 255 * 1.4 : 0,
    };
}

function applyLookGPU(gpu, canvas, faces, beauty, makeup, color) {
    const { width: w, height: h } = canvas;
    const ctx = canvas.getContext('2d');
    const retouch = beauty.retouch ?? beauty.smooth ?? 0;
    const toneR = beauty.toneRed ?? 0;
    const toneY = beauty.toneYellow ?? 0;
    const bright = beauty.brightness ?? 0;
    const skinOn = faces.length > 0 && (retouch > 0 || toneR > 0 || toneY > 0 || bright > 0);
    const blush = faces.length ? buildBlushLayer(w, h, faces, makeup) : null;
    const eye = makeup.eye ?? makeup.eyeBrighten ?? 0;
    const needProbe = faces.length > 0 && (skinOn || eye > 0 || (makeup.lipstick || 0) > 0 || (beauty.teeth || 0) > 0 || (makeup.brows || 0) > 0);
    const probe = needProbe ? readFaceRegion(canvas, faces) : null;

    if (skinOn || blush) {
        const mask = skinOn ? buildSkinMaskSmall(w, h, faces) : null;
        const fw = faces.length ? avgFaceWpx(faces, h) : 0;
        const fu = Number.isFinite(fw) ? fw : 0;
        gpuCall(() => gpu.skin(canvas, w, h, {
            retouch, toneR, toneY, addB: bright * 12,
            ref: mask ? skinReference(probe, mask, w, h) : null,
            sigmaS: Math.max(0.6, fu * 0.006), sigmaL: Math.max(2, fu * 0.028),
            mask, blush,
        }, ctx));
    }
    if (faces.length) {
        applyLips(canvas, faces, makeup, probe);
        enhanceEyes(canvas, faces, eye, probe);
        applyDarkCircles(canvas, faces, beauty.darkCircles || 0);
        whitenTeeth(canvas, faces, beauty.teeth || 0, probe);
        applyBrows(canvas, faces, makeup.brows || 0, probe);
        applyGlow(canvas, faces, beauty.glow || 0);
    }
    const cp = colorParams(color);
    if (cp) gpuCall(() => gpu.color(canvas, w, h, cp, ctx));
}

// Lỗi từ card đồ hoạ (khác lỗi canvas 2D) -> tắt đường card đồ hoạ cho tới lần tải lại trang.
function gpuCall(fn) {
    try {
        fn();
    } catch (e) {
        if (e && typeof e === 'object') e.tuCardDoHoa = true;
        throw e;
    }
}

// Ảnh lớn hơn ngưỡng này (ảnh gốc để in) giữ ~400 MB bộ nhớ card đồ hoạ -> trả lại sau khi xong việc. Hoãn
// GPU_RELEASE_MS để các ảnh gốc làm liền nhau (bấm Tiếp tục) dùng lại bộ nhớ thay vì cấp phát lại từng ảnh.
// Ảnh xem trước nhỏ hơn ngưỡng thì giữ, kéo thanh trượt không phải cấp phát lại.
const GPU_KEEP_PX = 3000 * 3000;
const GPU_RELEASE_MS = 3000;
let releaseTimer = null;
function scheduleRelease(gpu) {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => { releaseTimer = null; gpu.release(); }, GPU_RELEASE_MS);
}

/**
 * Áp toàn bộ look lên canvas (tại chỗ).
 * look = {
 *   beauty: { retouch, toneRed, toneYellow, brightness, glow, darkCircles, teeth },
 *   makeup: { blush, blushColor, lips, eye, lipstick, lipColor, brows },
 *   color:  { saturation, contrast, brightness, warmth, pinkTint, highlight }
 * }
 * opts.gpu = false: ép chạy đường canvas cũ (so sánh / máy có card đồ hoạ chạy sai).
 */
export function applyLook(canvas, faces, look = {}, opts = {}) {
    const beauty = look.beauty || {};
    const makeup = look.makeup || {};
    const color = look.color || {};
    if (!faces.length && !colorParams(color)) return; // không có gì để làm (khỏi giữ bản sao cỡ ảnh)

    const gpu = opts.gpu === false ? null : getLookGL();
    if (gpu && gpu.fits(canvas.width, canvas.height)) {
        // Lỗi giữa chừng thì trả ảnh về như cũ rồi chạy lại bằng canvas. opts.restore(ctx) = bên gọi tự vẽ
        // lại ảnh gốc (đỡ một bản sao cỡ ảnh — ~100 MB ở ảnh 6000 px); không có thì giữ bản sao.
        let backup = null;
        if (typeof opts.restore !== 'function') {
            backup = makeCanvas(canvas.width, canvas.height);
            backup.getContext('2d').drawImage(canvas, 0, 0);
        }
        try {
            applyLookGPU(gpu, canvas, faces, beauty, makeup, color);
            if (canvas.width * canvas.height > GPU_KEEP_PX) scheduleRelease(gpu);
            return;
        } catch (e) {
            console.warn('[lookStage] Lỗi khi làm đẹp bằng card đồ hoạ, chạy lại bằng canvas:', e);
            if (e?.tuCardDoHoa) setLookGLEnabled(false);
            const ctx = canvas.getContext('2d');
            // Lỗi có thể rơi giữa save()/restore() (clip, 'screen'...) -> xoá sạch trạng thái trước khi vẽ lại.
            if (typeof ctx.reset === 'function') ctx.reset();
            else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
            if (backup) ctx.drawImage(backup, 0, 0);
            else opts.restore(ctx);
        }
    }

    if (faces.length) {
        processSkin(canvas, faces, beauty);                 // L1 + L2
        applyBlush(canvas, faces, makeup);
        applyLips(canvas, faces, makeup);                   // L4 (tăng sắc + tô son, chung mask)
        enhanceEyes(canvas, faces, makeup.eye ?? makeup.eyeBrighten ?? 0); // L3
        applyDarkCircles(canvas, faces, beauty.darkCircles || 0);
        whitenTeeth(canvas, faces, beauty.teeth || 0);
        applyBrows(canvas, faces, makeup.brows || 0);
        applyGlow(canvas, faces, beauty.glow || 0);
    }

    applyColorGrade(canvas, color);                         // L6 (toàn ảnh)
}

/**
 * Như applyLook nhưng MỖI khuôn mặt một bộ làm đẹp riêng (bước Chỉnh ảnh: khách chỉnh từng người).
 * looks[i] = { beauty, makeup } cho faces[i]. Mặt cùng thông số gom thành một lượt (thường chỉ một lượt cho
 * cả ảnh); màu toàn ảnh áp một lần ở cuối. opts như applyLook — opts.restore chỉ dùng cho lượt đầu vì từ lượt
 * thứ hai ảnh đã có phần của lượt trước, phải giữ bản sao.
 */
export function applyLookFaces(canvas, faces, looks, color = {}, opts = {}) {
    const groups = new Map();
    faces.forEach((f, i) => {
        const look = looks[i] || {};
        const key = JSON.stringify([look.beauty || {}, look.makeup || {}]);
        if (!groups.has(key)) groups.set(key, { look, faces: [] });
        groups.get(key).faces.push(f);
    });
    let first = true;
    for (const { look, faces: fs } of groups.values()) {
        applyLook(canvas, fs, { beauty: look.beauty, makeup: look.makeup }, first ? opts : { gpu: opts.gpu });
        first = false;
    }
    applyLook(canvas, [], { color }, first ? opts : { gpu: opts.gpu });
}

// Hàm nội bộ cho trang đo / so sánh (.harness_tmp/c0). Không dùng trong app.
export const __test = { processSkin, applyBlush, applyLips, enhanceEyes, applyGlow, applyColorGrade, buildSkinMask: buildSkinMaskSmall, applyWhiteBalance, applyHighlight };
