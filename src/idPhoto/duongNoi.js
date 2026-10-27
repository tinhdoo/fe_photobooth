// duongNoi.js
// Tinh lại alpha ở viền tóc bằng "ĐƯỜNG NỐI": nền tại chỗ -> tiền cảnh tại chỗ.
//
// VÌ SAO (ảnh thật 25/10: khe giữa các sợi tóc còn nguyên màu tường cũ, sợi tóc lơ thơ bạc phếch):
//   Cách cũ dùng MỘT màu nền trung vị và MỘT ngưỡng T cho cả ảnh. T lấy trung vị khoảng cách màu của
//   vùng chắc-là-người — mà vùng đó phần lớn là DA MẶT, trên tường sáng thì da chỉ cách tường ~50/255.
//   Vậy T nhỏ, nên sợi tóc đen phủ 30% một pixel (cách tường ~90) đã bị đọc thành alpha 1 -> sợi tóc
//   mang theo màu tường, khử ám màu cũng không gỡ được. Thêm nữa, chỗ mask model >= 0,85 bị ép alpha 1,
//   nên khe tóc nằm trong mask (mask 512 phóng lên không phân giải được khe) giữ nguyên màu tường cũ.
//
// CÁCH MỚI: ở mỗi pixel viền, ước lượng màu nền NGAY ĐÓ (B) và màu tiền cảnh NGAY ĐÓ (F, trung bình các
// pixel chắc-là-người gần mép, nghiêng về pixel khác nền nhất = tóc), rồi chiếu C lên đoạn B -> F:
//     a = <C - B, F - B> / |F - B|²
// Pixel tóc + tường nằm trên đoạn đó; da / áo lệch sắc độ thì nằm XA đoạn đó -> không tin, giữ cách cũ.
//
// KHI NÀO KHÔNG TIN (trả lại đúng kết quả cách cũ):
//   - tóc đen trên rèm tối, áo trắng trên tường trắng: tiền cảnh gần đó có nhiều pixel trùng màu nền,
//     màu không còn phân biệt được người với nền -> chiếu lên đường nối sẽ khoét nhầm vào tóc;
//   - tương phản F-B yếu;
//   - pixel lệch xa đường nối (không phải hỗn hợp tóc + nền).
//
// Số đo (ảnh tổng hợp có đáp án: tường trắng / xám, tóc đen có khe và sợi lơ thơ, áo trắng trùng tường):
//                               sai alpha ở viền   sai màu ở viền   sai màu ở khe tóc
//   cách cũ   (tường trắng)          0,234              27,6              86,7
//   cách này  (tường trắng)          0,136              18,0              54,6
//   cách cũ   (tường xám)            0,192              21,9              64,5
//   cách này  (tường xám)            0,117              14,3              43,8
// Ảnh thật chụp trên rèm nhung tối (tóc gần trùng nền): gần như y hệt cách cũ, chỉ sạch thêm viền ngón tay.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Trong vùng mask chắc (>= 0,85) chỉ coi là khe khi RẤT giống nền; ở dải mép nới hơn. Tóc / áo tối khác
// màu trung bình tại chỗ một chút thì phép chiếu ra 0,7-0,9 chứ không phải 1 -> chia cho "đầu gối" này.
const GOI_TRONG = 0.6;
const GOI_DAI = 0.85;
// Quá 20% tiền cảnh lân cận trùng màu nền thì thôi tin màu.
const GIONG_MAX = 0.2;

/**
 * Làm mờ hộp (2r+1)x(2r+1), biên lặp lại pixel mép, trả về TRUNG BÌNH. Tách hai lượt ngang/dọc với tổng
 * trượt nên O(n) bất kể r — bán kính ở đây lên tới 1/4 cạnh ảnh.
 */
function hop(src, width, height, r) {
    r = Math.max(1, Math.round(r));
    const n = width * height;
    const tam = new Float32Array(n);
    const ra = new Float32Array(n);
    const k = 2 * r + 1;
    for (let y = 0; y < height; y++) {
        const row = y * width;
        let s = 0;
        for (let x = -r; x <= r; x++) s += src[row + (x < 0 ? 0 : x >= width ? width - 1 : x)];
        for (let x = 0; x < width; x++) {
            tam[row + x] = s;
            const xa = x - r, xv = x + r + 1;
            s += src[row + (xv >= width ? width - 1 : xv)] - src[row + (xa < 0 ? 0 : xa)];
        }
    }
    // Lượt dọc đi THEO HÀNG với một mảng tổng cột: đi theo cột nhảy cách `width` phần tử mỗi bước,
    // trượt cache, chậm gấp mấy lần.
    const kk = k * k;
    const cot = new Float64Array(width);
    for (let y = -r; y <= r; y++) {
        const row = (y < 0 ? 0 : y >= height ? height - 1 : y) * width;
        for (let x = 0; x < width; x++) cot[x] += tam[row + x];
    }
    for (let y = 0; y < height; y++) {
        const row = y * width;
        const ya = y - r, yv = y + r + 1;
        const rowA = (ya < 0 ? 0 : ya) * width, rowV = (yv >= height ? height - 1 : yv) * width;
        for (let x = 0; x < width; x++) {
            ra[row + x] = cot[x] / kk;
            cot[x] += tam[rowV + x] - tam[rowA + x];
        }
    }
    return ra;
}

/** Trung bình có trọng số w của ảnh RGBA trong cửa sổ bán kính r -> {mau (n*3), phu: trung bình w}. */
function trungBinhTrongSo(pixels, w, width, height, r) {
    const n = width * height;
    const kenh = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
        const q = i * 4, wi = w[i];
        kenh[0][i] = pixels[q] * wi; kenh[1][i] = pixels[q + 1] * wi; kenh[2][i] = pixels[q + 2] * wi;
    }
    const phu = hop(w, width, height, r);
    const mau = new Float32Array(n * 3);
    for (let c = 0; c < 3; c++) {
        const b = hop(kenh[c], width, height, r);
        for (let i = 0; i < n; i++) mau[i * 3 + c] = phu[i] > 1e-6 ? b[i] / phu[i] : 0;
    }
    return { mau, phu };
}

/**
 * Khoảng cách (px, xấp xỉ chamfer 1 / √2) từ mỗi pixel `trong` tới pixel `ngoai` gần nhất; pixel ngoài = 0.
 */
function khoangCach(trong, width, height) {
    const n = width * height;
    const INF = 1e9, CHEO = Math.SQRT2;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = trong[i] ? INF : 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            if (!d[i]) continue;
            let v = d[i];
            if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1;
            if (y > 0) {
                const u = i - width;
                if (d[u] + 1 < v) v = d[u] + 1;
                if (x > 0 && d[u - 1] + CHEO < v) v = d[u - 1] + CHEO;
                if (x < width - 1 && d[u + 1] + CHEO < v) v = d[u + 1] + CHEO;
            }
            d[i] = v;
        }
    }
    for (let y = height - 1; y >= 0; y--) {
        for (let x = width - 1; x >= 0; x--) {
            const i = y * width + x;
            if (!d[i]) continue;
            let v = d[i];
            if (x < width - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1;
            if (y < height - 1) {
                const u = i + width;
                if (d[u] + 1 < v) v = d[u] + 1;
                if (x < width - 1 && d[u + 1] + CHEO < v) v = d[u + 1] + CHEO;
                if (x > 0 && d[u - 1] + CHEO < v) v = d[u - 1] + CHEO;
            }
            d[i] = v;
        }
    }
    return d;
}

/**
 * Màu nền cũ THEO VÙNG (n*3): trung bình các pixel chắc-là-nền quanh đó, từ thô tới mịn. Tường thật có
 * độ dốc ánh sáng + vignetting, một màu trung vị cho cả ảnh lệch tới vài chục đơn vị ở góc.
 */
export function nenTheoVung(pixels, mask, width, height, oldBg) {
    const n = width * height;
    const L = Math.max(width, height);
    const wb = new Float32Array(n);
    for (let i = 0; i < n; i++) wb[i] = mask[i] <= 0.05 ? 1 : 0;
    const nen = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { nen[i * 3] = oldBg[0]; nen[i * 3 + 1] = oldBg[1]; nen[i * 3 + 2] = oldBg[2]; }
    for (const r of [0.25 * L, 0.08 * L, 0.03 * L]) {
        const { mau, phu } = trungBinhTrongSo(pixels, wb, width, height, r);
        for (let i = 0; i < n; i++) {
            if (phu[i] <= 0.15) continue;
            nen[i * 3] = mau[i * 3]; nen[i * 3 + 1] = mau[i * 3 + 1]; nen[i * 3 + 2] = mau[i * 3 + 2];
        }
    }
    return nen;
}

/**
 * @param {Uint8ClampedArray} pixels RGBA
 * @param {Float32Array} mask mask model 0..1
 * @param {[number,number,number]} oldBg màu nền trung vị (estimateOldBackground)
 * @param {Float32Array} aCu alpha của cách cũ (refineAlpha) — dùng ở mọi chỗ không tin được màu
 * @returns {{alpha: Float32Array, nen: Float32Array}} nen = màu nền cũ theo vùng (n*3) cho bước khử ám màu
 */
export function tinhTheoDuongNoi(pixels, mask, width, height, oldBg, aCu) {
    const n = width * height;
    const L = Math.max(width, height);
    const nen = nenTheoVung(pixels, mask, width, height, oldBg);

    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const q = i * 4, t = i * 3;
        const dr = pixels[q] - nen[t], dg = pixels[q + 1] - nen[t + 1], db = pixels[q + 2] - nen[t + 2];
        d[i] = Math.sqrt(dr * dr + dg * dg + db * db);
    }
    const nguoi = new Uint8Array(n), ngoai = new Uint8Array(n);
    for (let i = 0; i < n; i++) { nguoi[i] = mask[i] >= 0.5 ? 1 : 0; ngoai[i] = 1 - nguoi[i]; }
    const dmTrong = khoangCach(nguoi, width, height);  // người -> nền gần nhất
    const dmNgoai = khoangCach(ngoai, width, height);  // nền -> người gần nhất

    // Sàn nhiễu: phân vị 95 khoảng cách màu ở vành nền sát người (vải phông, nhiễu cảm biến, JPEG).
    const vanh = [];
    const buoc = Math.max(1, Math.floor(Math.sqrt(n / 40000)));
    for (let y = 0; y < height; y += buoc) {
        for (let x = 0; x < width; x += buoc) {
            const i = y * width + x;
            if (mask[i] <= 0.02 && dmNgoai[i] < 0.05 * L) vanh.push(d[i]);
        }
    }
    let nf = 12;
    if (vanh.length > 50) {
        vanh.sort((a, b) => a - b);
        nf = Math.max(6, vanh[Math.min(vanh.length - 1, Math.floor(vanh.length * 0.95))]);
    }

    const D = 0.02 * L;   // bề rộng vùng tìm khe tóc phía trong mép mask

    // Tiền cảnh tại chỗ: pixel chắc-là-người gần mép, trọng số (khoảng cách tới nền)² để nghiêng về thứ
    // khác nền nhất (tóc tối trên tường sáng) chứ không bị da/áo gần màu tường kéo về.
    const chac = new Float32Array(n), wf = new Float32Array(n), sau = new Float32Array(n), giong = new Float32Array(n);
    const nguongGiong = Math.max(2 * nf, 20);
    for (let i = 0; i < n; i++) {
        const dm = dmTrong[i];
        if (mask[i] < 0.95) continue;
        if (dm > 2 && dm <= 3 * D) { chac[i] = 1; const k = d[i] / 255; wf[i] = k * k; }
        // Mẫu để xét "tiền cảnh trùng màu nền": lấy SÂU hơn vùng khe (> D), nếu không thì chính các khe
        // lộ nền sẽ tự bật chế độ "không tin màu".
        if (dm > D && dm <= 4 * D) { sau[i] = 1; if (d[i] < nguongGiong) giong[i] = 1; }
    }
    const f1 = trungBinhTrongSo(pixels, wf, width, height, 0.015 * L);
    const f2 = trungBinhTrongSo(pixels, wf, width, height, 0.05 * L);
    const phu = hop(chac, width, height, 0.015 * L);
    // Hai tầm: tầm hẹp thì bàn tay / mặt sát bên lấn át một mảng tóc đen trên rèm tối -> cần tầm rộng.
    const g1 = hop(giong, width, height, 0.03 * L), s1 = hop(sau, width, height, 0.03 * L);
    const g2 = hop(giong, width, height, 0.06 * L), s2 = hop(sau, width, height, 0.06 * L);

    const alpha = new Float32Array(aCu);
    for (let i = 0; i < n; i++) {
        const m = mask[i];
        // Chỉ xét dải mép (0,02..0,85) và vùng khe sát mép phía trong; ngoài mask giữ nguyên.
        if (m <= 0.02 || (m >= 0.85 && dmTrong[i] > D)) continue;

        const dung2 = phu[i] < 0.08;
        const F = dung2 ? f2.mau : f1.mau;
        if ((dung2 ? f2.phu[i] : f1.phu[i]) < 1e-5) continue;   // không có tiền cảnh nào gần -> không đoán

        const tl = Math.max(s1[i] > 1e-6 ? g1[i] / s1[i] : 0, s2[i] > 1e-6 ? g2[i] / s2[i] : 0);
        const wGiong = clamp01((GIONG_MAX - tl) / 0.1);
        if (wGiong <= 0) continue;

        const q = i * 4, t = i * 3;
        const ibR = pixels[q] - nen[t], ibG = pixels[q + 1] - nen[t + 1], ibB = pixels[q + 2] - nen[t + 2];
        const fbR = F[t] - nen[t], fbG = F[t + 1] - nen[t + 1], fbB = F[t + 2] - nen[t + 2];
        const n2 = Math.max(1e-6, fbR * fbR + fbG * fbG + fbB * fbB);
        const tp = Math.sqrt(n2);
        const wTp = clamp01((tp - 50) / 40);   // tương phản yếu (áo trắng trên tường trắng) -> không tin
        if (wTp <= 0) continue;

        const p = (ibR * fbR + ibG * fbG + ibB * fbB) / n2;
        const p01 = clamp01(p);
        const rR = ibR - p01 * fbR, rG = ibG - p01 * fbG, rB = ibB - p01 * fbB;
        const res = Math.sqrt(rR * rR + rG * rG + rB * rB);
        // Pixel phải NẰM TRÊN đường nối (hỗn hợp tóc + nền); da / áo lệch sắc độ thì lệch xa -> không tin.
        const lech = res / Math.max(nf, 0.35 * Math.max(d[i], 1e-3));
        const wLine = clamp01((1.6 - lech) / 0.6) * wTp * wGiong;
        if (wLine <= 0) continue;

        // Trừ sàn nhiễu: nền thuần + nhiễu chiếu ra cỡ nf/tp, không được đọc thành "có tóc".
        const de = Math.min(0.5, nf / Math.max(tp, 1));
        const aLine = clamp01(clamp01((p - de) / (1 - de)) / (m >= 0.85 ? GOI_TRONG : GOI_DAI));
        alpha[i] = wLine * aLine + (1 - wLine) * aCu[i];
    }
    return { alpha, nen };
}
