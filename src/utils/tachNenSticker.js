// Tách nền sticker ngay trong trình duyệt (không model, không gửi ảnh đi đâu).
// Hợp với sticker/hoạ tiết trên nền trơn (trắng hoặc một màu, kể cả JPG nhiễu nhẹ): đoán màu nền từ viền ảnh,
// loang từ mép vào những điểm gần màu nền -> trong suốt. Chỉ xoá vùng NỐI với mép nên phần trắng bên trong
// nhân vật (mắt, răng...) vẫn giữ; bật `xoaLoBenTrong` để xoá cả nền kẹt giữa tay và thân.
// Viền: điểm ranh giới được cho alpha theo độ khác màu nền và gỡ lẫn màu nền (khỏi viền trắng/răng cưa).

const CANH_TOI_DA = 1200; // sticker không cần to hơn -> nhẹ khi tải lên và khi khách kéo trên booth

export async function docAnh(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const tile = Math.min(1, CANH_TOI_DA / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * tile));
        const h = Math.max(1, Math.round(img.naturalHeight * tile));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        return c;
    } finally {
        URL.revokeObjectURL(url);
    }
}

// Ảnh đã có nền trong suốt (phần lớn viền đã trong suốt) -> không cần tách.
export function daTrongSuot(canvas) {
    const { width: w, height: h } = canvas;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    let trong = 0, tong = 0;
    const xet = (x, y) => { tong += 1; if (d[(y * w + x) * 4 + 3] < 20) trong += 1; };
    for (let x = 0; x < w; x += 2) { xet(x, 0); xet(x, h - 1); }
    for (let y = 0; y < h; y += 2) { xet(0, y); xet(w - 1, y); }
    return trong / tong > 0.5;
}

// Màu nền = trung vị từng kênh của các điểm viền (bền với vài điểm nhân vật chạm mép).
function mauNen(d, w, h) {
    const r = [], g = [], b = [];
    const lay = (x, y) => { const i = (y * w + x) * 4; if (d[i + 3] > 200) { r.push(d[i]); g.push(d[i + 1]); b.push(d[i + 2]); } };
    for (let x = 0; x < w; x++) { lay(x, 0); lay(x, h - 1); }
    for (let y = 0; y < h; y++) { lay(0, y); lay(w - 1, y); }
    const tv = (a) => { if (!a.length) return 255; a.sort((p, q) => p - q); return a[a.length >> 1]; };
    return [tv(r), tv(g), tv(b)];
}

/**
 * @param {HTMLCanvasElement} nguon ảnh gốc (từ docAnh)
 * @param {{ doNhay?: number, xoaLoBenTrong?: boolean }} tuyChon doNhay 5..120: khoảng cách màu (RGB) coi là nền
 * @returns {HTMLCanvasElement} ảnh đã tách nền, cắt sát nội dung (chừa lề 8px)
 */
export function tachNen(nguon, { doNhay = 40, xoaLoBenTrong = false } = {}) {
    const { width: w, height: h } = nguon;
    const anh = nguon.getContext('2d').getImageData(0, 0, w, h);
    const d = anh.data;
    const nen = mauNen(d, w, h);
    const n = w * h;

    // Khoảng cách màu tới nền (điểm đã trong suốt coi như nền).
    const kc = new Float32Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
        kc[p] = d[i + 3] < 20 ? 0 : Math.hypot(d[i] - nen[0], d[i + 1] - nen[1], d[i + 2] - nen[2]);
    }

    // 1 = nền. Loang từ mép (hoặc lấy mọi điểm gần màu nền nếu xoá cả lỗ bên trong).
    const laNen = new Uint8Array(n);
    if (xoaLoBenTrong) {
        for (let p = 0; p < n; p++) if (kc[p] < doNhay) laNen[p] = 1;
    } else {
        const hang = new Int32Array(n);
        let dau = 0, cuoi = 0;
        const them = (p) => { if (!laNen[p] && kc[p] < doNhay) { laNen[p] = 1; hang[cuoi++] = p; } };
        for (let x = 0; x < w; x++) { them(x); them((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { them(y * w); them(y * w + w - 1); }
        while (dau < cuoi) {
            const p = hang[dau++];
            const x = p % w;
            if (x > 0) them(p - 1);
            if (x < w - 1) them(p + 1);
            if (p >= w) them(p - w);
            if (p < n - w) them(p + w);
        }
    }

    // Ranh giới: điểm giữ lại sát nền, còn hơi giống màu nền -> alpha mềm + gỡ lẫn màu nền.
    const mem = doNhay * 1.6;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
        if (laNen[p]) { d[i + 3] = 0; continue; }
        const x = p % w;
        const keNen = (x > 0 && laNen[p - 1]) || (x < w - 1 && laNen[p + 1]) || (p >= w && laNen[p - w]) || (p < n - w && laNen[p + w]);
        if (!keNen || kc[p] >= mem) continue;
        const a = Math.max(0.15, (kc[p] - doNhay) / (mem - doNhay));
        for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, Math.round((d[i + k] - (1 - a) * nen[k]) / a)));
        d[i + 3] = Math.round(d[i + 3] * a);
    }

    // Cắt sát nội dung.
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
    }
    const ra = document.createElement('canvas');
    if (x1 < 0) { ra.width = w; ra.height = h; ra.getContext('2d').putImageData(anh, 0, 0); return ra; } // xoá hết -> trả nguyên khung
    const le = 8;
    x0 = Math.max(0, x0 - le); y0 = Math.max(0, y0 - le); x1 = Math.min(w - 1, x1 + le); y1 = Math.min(h - 1, y1 + le);
    ra.width = x1 - x0 + 1; ra.height = y1 - y0 + 1;
    ra.getContext('2d').putImageData(anh, -x0, -y0, x0, y0, ra.width, ra.height);
    return ra;
}

export const sangBlob = (canvas) => new Promise((ok) => canvas.toBlob(ok, 'image/png'));
