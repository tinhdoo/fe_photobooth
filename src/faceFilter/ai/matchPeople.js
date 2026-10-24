// matchPeople.js — ghép "cùng một người" qua các ảnh của một lượt chụp (bước Chỉnh ảnh: chỉnh riêng bạn A ở ảnh 1
// thì áp đúng cho bạn A ở các ảnh khác; đánh số người giống nhau trên mọi ảnh).
// Mỗi mặt có: cx (0..1, tâm mặt theo chiều ngang), fw (bề rộng mặt, cùng đơn vị với cx), desc (đặc trưng màu:
// tóc / da / áo quanh mặt). Máy ảnh booth đứng yên và các kiểu chụp cách nhau vài giây nên VỊ TRÍ là manh mối
// chính; MÀU giúp gỡ khi khách đổi chỗ cho nhau. Đo ở C0 (23/10/2026): ảnh đôi đổi chỗ + nghiêng mặt đúng 3/3,
// chỉ dùng vị trí thì sai 2/3.

const HB = 8, SB = 4, VB = 4;              // số ô histogram H/S/V cho mỗi vùng
const REGION_DIMS = HB + SB + VB;

function rgbToHsv(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 0) {
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6; if (h < 0) h += 1;
    }
    return [h, mx === 0 ? 0 : d / mx, mx / 255];
}

function regionHist(data, W, H, x0, y0, x1, y1, out, off) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    if (x1 - x0 < 2 || y1 - y0 < 2) return false;
    const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 900)));
    let n = 0;
    for (let y = y0; y < y1; y += step) {
        for (let x = x0; x < x1; x += step) {
            const i = (y * W + x) * 4;
            const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
            // Màu nhạt / tối thì H vô nghĩa -> chỉ tính S, V.
            if (s > 0.15 && v > 0.15) out[off + Math.min(HB - 1, Math.floor(h * HB))] += 1;
            out[off + HB + Math.min(SB - 1, Math.floor(s * SB))] += 1;
            out[off + HB + SB + Math.min(VB - 1, Math.floor(v * VB))] += 1;
            n += 1;
        }
    }
    for (let k = 0; k < REGION_DIMS; k++) out[off + k] /= n || 1;
    return true;
}

/** Đặc trưng màu của 1 mặt: [tóc | da 2 má | áo] — đọc từ ImageData của ảnh (kích thước xem trước). */
export function faceDescriptor(imageData, face) {
    const { data, width: W, height: H } = imageData;
    const xs = face.rings.faceOval.map((p) => p.x * W);
    const ys = face.rings.faceOval.map((p) => p.y * H);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const fw = x1 - x0, fh = y1 - y0;
    const out = new Float32Array(REGION_DIMS * 3);
    regionHist(data, W, H, x0 + 0.1 * fw, y0 - 0.35 * fh, x1 - 0.1 * fw, y0 + 0.05 * fh, out, 0);            // tóc
    const cl = face.points.cheekLeft, cr = face.points.cheekRight, r = 0.1 * fw;
    const skin = new Float32Array(REGION_DIMS * 2);
    regionHist(data, W, H, cl.x * W - r, cl.y * H - r, cl.x * W + r, cl.y * H + r, skin, 0);
    regionHist(data, W, H, cr.x * W - r, cr.y * H - r, cr.x * W + r, cr.y * H + r, skin, REGION_DIMS);
    for (let k = 0; k < REGION_DIMS; k++) out[REGION_DIMS + k] = (skin[k] + skin[REGION_DIMS + k]) / 2; // da
    const cx = (x0 + x1) / 2;
    regionHist(data, W, H, cx - 0.7 * fw, y1 + 0.3 * fh, cx + 0.7 * fw, y1 + 1.0 * fh, out, REGION_DIMS * 2); // áo
    return out;
}

// Khoảng cách Hellinger trung bình của các vùng (0 = giống hệt, 1 = khác hẳn).
function descDist(a, b) {
    let tot = 0, regions = 0;
    for (let r = 0; r < 3; r++) {
        for (const [o, len] of [[0, HB], [HB, SB], [HB + SB, VB]]) {
            let bc = 0, sa = 0, sb = 0;
            for (let k = 0; k < len; k++) {
                const i = r * REGION_DIMS + o + k;
                sa += a[i]; sb += b[i];
            }
            if (sa <= 0 || sb <= 0) continue;
            for (let k = 0; k < len; k++) {
                const i = r * REGION_DIMS + o + k;
                bc += Math.sqrt((a[i] / sa) * (b[i] / sb));
            }
            tot += Math.sqrt(Math.max(0, 1 - bc));
            regions += 1;
        }
    }
    return regions ? tot / regions : 0.5;
}

// Hungarian (Kuhn-Munkres) cho ma trận vuông n×n, trả assign[row] = col. n <= ~24.
function hungarian(cost) {
    const n = cost.length, INF = 1e18;
    const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0);
    const p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
    for (let i = 1; i <= n; i++) {
        p[0] = i; let j0 = 0;
        const minv = new Array(n + 1).fill(INF), used = new Array(n + 1).fill(false);
        do {
            used[j0] = true;
            const i0 = p[j0]; let delta = INF, j1 = 0;
            for (let j = 1; j <= n; j++) {
                if (used[j]) continue;
                const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                if (minv[j] < delta) { delta = minv[j]; j1 = j; }
            }
            for (let j = 0; j <= n; j++) {
                if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
            }
            j0 = j1;
        } while (p[j0] !== 0);
        do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const assign = new Array(n).fill(-1);
    for (let j = 1; j <= n; j++) if (p[j]) assign[p[j] - 1] = j - 1;
    return assign;
}

/**
 * photos: [{ faces: [{ cx, fw, desc }] }]  (thứ tự = thứ tự chụp)
 * opts.useColor: false = chỉ theo vị trí.
 * Trả về: ids[photo][face] = số người (0, 1, 2…; đánh số trái -> phải theo ảnh đông người nhất).
 */
export function matchPeople(photos, { useColor = true, wPos = 0.4, wSize = 0.6, wColor = 8, newCost = 3 } = {}) {
    const ids = photos.map((p) => p.faces.map(() => -1));
    if (!photos.length) return ids;
    let ref = 0;
    photos.forEach((p, i) => { if (p.faces.length > photos[ref].faces.length) ref = i; });
    const tracks = [];
    const order = photos[ref].faces.map((f, k) => k).sort((a, b) => photos[ref].faces[a].cx - photos[ref].faces[b].cx);
    order.forEach((k) => {
        const f = photos[ref].faces[k];
        ids[ref][k] = tracks.length;
        tracks.push({ cx: f.cx, fw: f.fw, desc: f.desc ? Float32Array.from(f.desc) : null, n: 1 });
    });
    // Đi từ ảnh tham chiếu ra hai phía: ảnh liền kề giống nhau nhất.
    const seq = [];
    for (let d = 1; d < photos.length; d++) {
        if (ref + d < photos.length) seq.push(ref + d);
        if (ref - d >= 0) seq.push(ref - d);
    }
    for (const pi of seq) {
        const faces = photos[pi].faces;
        if (!faces.length) continue;
        const nF = faces.length, nT = tracks.length, n = nF + nT;
        const cost = Array.from({ length: n }, () => new Array(n).fill(0));
        for (let a = 0; a < n; a++) {
            for (let b = 0; b < n; b++) {
                if (a < nF && b < nT) {
                    const f = faces[a], t = tracks[b];
                    const s = (f.fw + t.fw) / 2;
                    let c = wPos * Math.abs(f.cx - t.cx) / s + wSize * Math.abs(Math.log(f.fw / t.fw));
                    if (useColor && f.desc && t.desc) c += wColor * descDist(f.desc, t.desc);
                    cost[a][b] = c;
                } else if (a < nF) cost[a][b] = newCost;   // mặt -> người mới
                else cost[a][b] = b < nT ? newCost : 0;    // người vắng mặt ở ảnh này
            }
        }
        const assign = hungarian(cost);
        for (let a = 0; a < nF; a++) {
            const b = assign[a];
            const f = faces[a];
            if (b < nT && cost[a][b] < newCost) {
                ids[pi][a] = b;
                const t = tracks[b];
                t.cx = (t.cx * t.n + f.cx) / (t.n + 1);
                t.fw = (t.fw * t.n + f.fw) / (t.n + 1);
                if (t.desc && f.desc) for (let k = 0; k < t.desc.length; k++) t.desc[k] = (t.desc[k] * t.n + f.desc[k]) / (t.n + 1);
                t.n += 1;
            } else {
                ids[pi][a] = tracks.length;
                tracks.push({ cx: f.cx, fw: f.fw, desc: f.desc ? Float32Array.from(f.desc) : null, n: 1 });
            }
        }
    }
    return ids;
}

export const DESC_DIMS = REGION_DIMS * 3;
export { REGION_DIMS };

/** Đầu vào cho matchPeople từ ảnh (thường là bản xem trước) + danh sách mặt của nó. */
export function facesForMatching(canvas, faces) {
    if (!faces.length) return [];
    const img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return faces.map((f) => {
        const xs = f.rings.faceOval.map((p) => p.x);
        const x0 = Math.min(...xs), x1 = Math.max(...xs);
        return { cx: (x0 + x1) / 2, fw: x1 - x0, desc: faceDescriptor(img, f) };
    });
}
