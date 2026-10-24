// replaceBackground.js
// Thay nền ảnh chân dung bằng một màu trơn (xanh dương / trắng / xám...).
//
// VÌ SAO KHÔNG CHỈ DÙNG MASK CỦA MODEL:
// MediaPipe luôn suy luận ở lưới 256x256 rồi phóng bilinear lên cỡ ảnh, nên ở ảnh 6000 px ngang
// thì 1 pixel model ≈ 23 pixel ảnh. Tóc sợi mảnh KHÔNG thể tách bằng model, và đổi ảnh vào to hơn
// cũng vô ích. Cắt thẳng theo mask sẽ ra viền răng cưa — khách nhìn là thấy ngay.
//
// CÁCH CHỮA (3 bước, chạy ở ĐỘ PHÂN GIẢI ẢNH GỐC nên phân giải được từng sợi tóc):
//   1. Dựng trimap: chắc-chắn-người / chắc-chắn-nền / chưa-biết, từ mask đã co giãn.
//   2. Trong dải chưa-biết, tính alpha theo MÀU chứ không theo model. Booth chụp phông trơn nên
//      ước lượng được màu nền cũ; alpha = khoảng cách màu tới nền / khoảng cách tiền cảnh tới nền.
//   3. Khử ám màu: gỡ phần màu nền cũ còn dính trên tóc, nếu không tóc sẽ ám xanh trên nền mới.

/** Màu nền dựng sẵn. Ảnh hồ sơ VN hay dùng xanh dương; hộ chiếu/GPLX yêu cầu TRẮNG. */
export const BACKGROUNDS = [
    { id: 'blue',       ten: 'Xanh dương',  rgb: [42, 106, 187] },
    { id: 'blue_light', ten: 'Xanh nhạt',   rgb: [126, 178, 228] },
    { id: 'white',      ten: 'Trắng',       rgb: [255, 255, 255] },
    { id: 'gray',       ten: 'Xám',         rgb: [200, 200, 200] },
    { id: 'red',        ten: 'Đỏ',          rgb: [200, 46, 46] },
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Chặn trên cho hệ số khử ám màu (1-a)/a. Không chặn thì ở a nhỏ phép sửa khuếch đại nhiễu
// vô hạn -> lấm tấm ở viền tóc. Đo trên 5 ảnh thật: nhiễu thừa 3,94 -> 0,95 khi chặn ở 1,
// đổi lại ám màu còn sót chỉ tăng 6%. Giá trị 1 tương ứng mức sửa mà a = 0,5 sinh ra.
const DESPILL_CAP = 1.0;

// ---------------------------------------------------------------------------
// ĐƯỜNG "CÓ ẢNH NỀN TRỐNG" (clean plate): chụp thêm MỘT kiểu phông không có người, cùng khung,
// cùng khẩu/tốc/ISO/cân bằng trắng, rồi trừ theo TỪNG PIXEL.
//
// Vì sao ăn đứt cách hiện tại: bây giờ tôi đoán màu nền bằng MỘT màu trung vị cho cả ảnh. Phông
// thật không bao giờ một màu — có gradient đèn, vignetting của ống kính, nếp vải, bóng đổ. Sai số
// đó cộng thẳng vào d = |C - B| nên phải để sàn T = 40 và dải viền hẹp mới không ăn nhầm phông.
// Có ảnh nền trống thì B biết ở ĐÚNG pixel đó, mọi thứ vừa kể tự triệt tiêu, d chỉ còn phần do
// người gây ra. Nhờ vậy dám NỚI RỘNG dải xét ra ngoài xa hơn — và đó mới là chỗ ăn thêm sợi tóc,
// vì mask 256x256 của model không hề biết có sợi tóc ở đó.
//
// BA ĐIỀU KIỆN, thiếu một là hỏng, nên có kiểm tra tự động ở chuanBiNenTrong():
//   1. Máy ảnh KHÔNG xê dịch giữa hai kiểu (lệch nửa pixel đủ hỏng viền tóc).
//   2. Khoá phơi sáng và cân bằng trắng (auto sẽ đo lại khi có người đứng vào -> phông đổi độ sáng).
//   3. Phông không đổi (gió thổi rèm, ai đi qua...).
//
// ĐIỀU KHÔNG CHỮA ĐƯỢC: bóng người đổ lên phông cho C = k·B với k < 1 đều ba kênh — mà tóc đen
// che một phần phông cũng cho ĐÚNG dạng đó (C = (1-a)·B khi F ≈ 0). Hai thứ này bằng nhau về
// toán học, không tách được bằng một khung hình. Nên vẫn phải dựa vào mask của model để định vị:
// bóng đổ nằm ngoài dải nới rộng quanh người thì bị loại, nằm trong thì lọt. Muốn hết hẳn phải
// tách đèn phông khỏi đèn người ở khâu CHỤP, không phải ở khâu xử lý.
const W_COLOR_NEN = 0.92;   // có nền trống thì tin MÀU gần như tuyệt đối, mask chỉ còn định vị
const BAND_K_NEN = 0.010;   // dải xét rộng gấp 2,5 lần mức thường (0,004) — chỗ ăn thêm sợi tóc
const NGUONG_LECH_NEN = 20; // lệch TRUNG VỊ ở vùng phông trống, quá mức này coi như hai ảnh không khớp

// Ngưỡng thứ hai, bắt kiểu hỏng mà trung vị KHÔNG bắt được: máy ảnh xê dịch.
// Đo được (phông có 3 nếp vải + 1 mép ngang, chiếm ~1,3% diện tích):
//     xê dịch      lệch trung vị      p95 của lệch
//     0 px             3,32               5,9
//     1 px             3,46              34,1
//     2 px             3,61              34,7
//     4 px             3,61              37,6
// Trung vị gần như đứng yên vì nếp vải quá ít pixel — đúng bản chất của trung vị. Nhưng p95 nhảy
// gấp 6 lần ngay từ 1 px. Nên phải xét CẢ HAI: trung vị bắt lệch toàn cục (sai cảnh, sai sáng),
// p95 bắt lệch cục bộ (xê máy làm nếp vải lệch khỏi chính nó).
// Ngưỡng đặt TƯƠNG ĐỐI theo mức nhiễu đo được chứ không đặt cứng: máy ảnh khác nhau, ISO khác
// nhau thì sàn nhiễu khác nhau, một con số tuyệt đối sẽ báo oan trên máy nhiễu và bỏ lọt trên máy
// sạch. Trên 5 cặp đo được p95/trung vị ≈ 1,8 khi khớp và ≈ 10 khi lệch, nên hệ số 4 nằm giữa,
// cách xa cả hai phía. Sàn tuyệt đối 18 để cặp ảnh cực sạch (trung vị ≈ 1) không bị loại oan.
const NGUONG_P95_HE_SO = 4;
const NGUONG_P95_SAN = 18;

/**
 * Nới rộng vùng "quanh người" ra r pixel, trả về mặt nạ nhị phân.
 * Tách làm hai lượt ngang rồi dọc: phép nới hình vuông tách rời được theo trục, nên O(n·r)
 * thay vì O(n·r²). Ở 708x944 với r = 9 thì đây là ~12 triệu phép so, chạy trong vài chục ms.
 */
function noRongDai(mask, width, height, r, nguong) {
    const n = width * height;
    const tam = new Uint8Array(n);
    const ra = new Uint8Array(n);
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            const x0 = x - r < 0 ? 0 : x - r;
            const x1 = x + r >= width ? width - 1 : x + r;
            let v = 0;
            for (let xx = x0; xx <= x1; xx++) if (mask[row + xx] > nguong) { v = 1; break; }
            tam[row + x] = v;
        }
    }
    for (let y = 0; y < height; y++) {
        const y0 = y - r < 0 ? 0 : y - r;
        const y1 = y + r >= height ? height - 1 : y + r;
        const row = y * width;
        for (let x = 0; x < width; x++) {
            let v = 0;
            for (let yy = y0; yy <= y1; yy++) if (tam[yy * width + x]) { v = 1; break; }
            ra[row + x] = v;
        }
    }
    return ra;
}

/**
 * Đối chiếu ảnh nền trống với ảnh có khách, bù chênh sáng, đo sàn nhiễu, và TỰ TỪ CHỐI nếu hai
 * ảnh không khớp. Từ chối là phần quan trọng nhất ở đây: ảnh nền sai còn tệ hơn không có ảnh nền,
 * vì nó sai ở khắp nơi chứ không riêng ở viền.
 *
 * @param {Uint8ClampedArray} platePx RGBA của ảnh nền trống, ĐÃ vẽ về đúng width x height
 * @param {Uint8ClampedArray} pixels  RGBA của ảnh có khách
 * @returns {{nen?:Float32Array, gain?:number[], duLech?:number, san?:number, loi:string|null}}
 *          nen = ảnh nền đã bù sáng, lưu phẳng 3 kênh (chỉ số i*3)
 */
export function chuanBiNenTrong(platePx, pixels, mask, width, height) {
    const n = width * height;
    const step = Math.max(1, Math.floor(Math.sqrt(n / 40000)));
    const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };

    // 1. Bù chênh phơi sáng theo TỪNG KÊNH. Lấy trung vị tỉ số C/B trên vùng model chắc chắn là
    //    nền: ở đó lẽ ra C phải bằng B, lệch bao nhiêu là do máy đo sáng / cân bằng trắng đổi.
    //    Bỏ pixel nền quá tối (B <= 8) vì phép chia ở đó khuếch đại nhiễu thành số vô nghĩa.
    const ty = [[], [], []];
    for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
            const i = y * width + x;
            if (mask[i] > 0.05) continue;
            const q = i * 4;
            for (let c = 0; c < 3; c++) {
                const b = platePx[q + c];
                if (b > 8) ty[c].push(pixels[q + c] / b);
            }
        }
    }
    if (ty[0].length < 200) {
        return { loi: 'Không đủ vùng phông trống để đối chiếu — ảnh nền có thể lệch khung, hoặc model tách sai.' };
    }
    // Chặn [0,5 ; 2]: ngoài dải này thì không còn là "chênh phơi sáng" nữa mà là hai cảnh khác
    // nhau, bù tiếp chỉ giấu lỗi đi chứ không sửa được gì.
    const gain = ty.map((a) => Math.min(2, Math.max(0.5, med(a))));

    const nen = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const q = i * 4, t = i * 3;
        nen[t] = platePx[q] * gain[0];
        nen[t + 1] = platePx[q + 1] * gain[1];
        nen[t + 2] = platePx[q + 2] * gain[2];
    }

    // 2. Sàn nhiễu: ở vùng phông trống |C - B| lẽ ra bằng 0. Còn lại bao nhiêu chính là nhiễu cảm
    //    biến + nén JPEG + lệch khung. Mọi khác biệt DƯỚI mức đó không được coi là người, nếu
    //    không thì cả nền sẽ lấm tấm. Dùng MAD chứ không phải độ lệch chuẩn: mask hỏng là tóc/áo
    //    lọt vào mẫu, một nhúm giá trị lớn kéo lệch chuẩn đi rất xa còn MAD thì không.
    const res = [];
    for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
            const i = y * width + x;
            if (mask[i] > 0.05) continue;
            const q = i * 4, t = i * 3;
            const dr = pixels[q] - nen[t], dg = pixels[q + 1] - nen[t + 1], db = pixels[q + 2] - nen[t + 2];
            res.push(Math.sqrt(dr * dr + dg * dg + db * db));
        }
    }
    const duLech = med(res);
    const mad = med(res.map((v) => Math.abs(v - duLech))) * 1.4826;
    const san = Math.max(6, duLech + 3 * mad);
    // res da duoc med() sap xep -> lay phan vi truc tiep.
    const p95 = res[Math.min(res.length - 1, Math.floor(res.length * 0.95))];
    const p99 = res[Math.min(res.length - 1, Math.floor(res.length * 0.99))];

    const nguongP95 = Math.max(NGUONG_P95_SAN, NGUONG_P95_HE_SO * duLech);
    let loi = null;
    if (duLech > NGUONG_LECH_NEN) {
        loi = 'Ảnh nền và ảnh có khách lệch nhau ' + duLech.toFixed(0) + '/255 trên KHẮP vùng phông trống '
            + '(ngưỡng ' + NGUONG_LECH_NEN + '). Hai tấm chụp ở hai điều kiện khác nhau — đổi đèn, đổi phông, '
            + 'hoặc phơi sáng / cân bằng trắng lệch quá xa mức bù được.';
    } else if (p95 > nguongP95) {
        loi = 'Lệch CỤC BỘ: 5% số pixel phông lệch quá ' + p95.toFixed(0) + '/255 trong khi phần còn lại chỉ lệch '
            + duLech.toFixed(0) + ' (ngưỡng ' + nguongP95.toFixed(0) + '). Dấu hiệu máy ảnh đã xê dịch giữa hai kiểu '
            + '— nếp phông lệch khỏi chính nó. Kê lại máy rồi chụp lại ảnh nền.';
    }
    return { nen, gain, duLech, mad, san, p95, p99, nguongP95, loi };
}

// Nhả luồng chính một nhịp để trình duyệt kịp vẽ. Không có cái này thì mọi vòng lặp pixel bên
// dưới chạy liền mạch -> màn hình ĐƠ CỨNG, spinner đứng im, khách tưởng máy treo.
// (Đã gặp thật: ảnh Canon 10,6 MP khoá luồng chính hơn 90 giây.)
const nhaLuong = () => new Promise((r) => setTimeout(r, 0));

/**
 * Ước lượng màu nền CŨ từ những pixel model chắc chắn là nền.
 * Dùng trung vị theo từng kênh (không phải trung bình) để một mảng tối/sáng lạc không kéo lệch.
 */
export function estimateOldBackground(pixels, mask, width, height) {
    const rs = [], gs = [], bs = [];
    const n = width * height;
    // Lấy mẫu thưa cho nhanh: ảnh vài triệu pixel không cần duyệt hết.
    const step = Math.max(1, Math.floor(Math.sqrt(n / 20000)));
    for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
            const i = y * width + x;
            if (mask[i] > 0.05) continue;      // chỉ lấy chỗ CHẮC CHẮN là nền
            const p = i * 4;
            rs.push(pixels[p]); gs.push(pixels[p + 1]); bs.push(pixels[p + 2]);
        }
    }
    if (rs.length < 50) return null;           // không đủ nền -> bỏ qua bước gỡ màu
    const med = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
    return [med(rs), med(gs), med(bs)];
}

/**
 * Tinh chỉnh alpha ở dải viền bằng màu.
 * @returns Float32Array alpha [0..1] cùng kích thước mask.
 */
export function refineAlpha(pixels, mask, width, height, oldBg, nenTrong) {
    const n = width * height;
    const alpha = new Float32Array(n);

    // Bán kính dải "chưa biết". Tỉ lệ theo cạnh dài để ảnh to/nhỏ đều cho dải tương đương nhau.
    const k = Math.max(2, Math.round(0.004 * Math.max(width, height)));

    // Không có màu nền -> chỉ làm mượt mask, không gỡ màu được.
    if (!oldBg) {
        for (let i = 0; i < n; i++) alpha[i] = clamp01((mask[i] - 0.35) / 0.3);
        return alpha;
    }

    // Có ảnh nền trống dùng được -> B biết theo từng pixel, dải xét nới rộng, tin màu gần tuyệt đối.
    const nen = nenTrong && nenTrong.nen && !nenTrong.loi ? nenTrong : null;
    const wColor = nen ? W_COLOR_NEN : 0.75;
    const dai = nen
        ? noRongDai(mask, width, height,
                    Math.max(k, Math.round(BAND_K_NEN * Math.max(width, height))), 0.5)
        : null;
    // Khoảng cách tới nền: theo TỪNG PIXEL nếu có ảnh nền trống, theo một màu chung nếu không.
    // Trừ sàn nhiễu để phần chênh do nhiễu cảm biến không bị đọc thành "có người ở đây".
    const khoangCach = nen
        ? (i) => {
            const q = i * 4, t = i * 3;
            const dr = pixels[q] - nen.nen[t], dg = pixels[q + 1] - nen.nen[t + 1],
                  db = pixels[q + 2] - nen.nen[t + 2];
            const d = Math.sqrt(dr * dr + dg * dg + db * db) - nen.san;
            return d > 0 ? d : 0;
        }
        : (i) => {
            const q = i * 4;
            const dr = pixels[q] - oldBg[0], dg = pixels[q + 1] - oldBg[1], db = pixels[q + 2] - oldBg[2];
            return Math.sqrt(dr * dr + dg * dg + db * db);
        };

    // Chuẩn hoá: khoảng cách màu ĐIỂN HÌNH giữa tiền cảnh và nền. Lấy trung vị trên các pixel
    // chắc chắn là người, để công thức alpha không phụ thuộc một pixel cá biệt.
    const dists = [];
    const step = Math.max(1, Math.floor(Math.sqrt(n / 20000)));
    for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
            const i = y * width + x;
            if (mask[i] < 0.95) continue;
            dists.push(khoangCach(i));
        }
    }
    dists.sort((a, b) => a - b);
    // Dùng trung vị; sàn 40 để tránh chia cho số quá nhỏ khi áo trùng màu nền.
    const T = Math.max(40, dists.length ? dists[dists.length >> 1] : 120);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const m = mask[i];

            if (m >= 0.85) { alpha[i] = 1; continue; }   // chắc chắn người
            // Ngoài dải xét thì là nền, dứt khoát. Không có ảnh nền trống thì dải do mask định
            // (hẹp, vì màu nền chỉ đoán được MỘT màu chung); có ảnh nền trống thì dải là vùng nới
            // rộng quanh người, rộng hơn nhiều vì màu bây giờ đủ tin để phán ở xa hơn.
            if (dai ? !dai[i] : m <= 0.02) { alpha[i] = 0; continue; }

            // Dải chưa biết -> quyết định bằng MÀU, ở đúng độ phân giải ảnh gốc.
            const aColor = clamp01(khoangCach(i) / T);

            // Trộn với mask model: màu quyết định phần lớn, mask giữ vai trò định vị để
            // vệt sáng/tối trên phông không bị nhận nhầm thành tóc.
            alpha[i] = clamp01(aColor * (wColor + (1 - wColor) * m));
        }
    }

    // Làm mềm một nhịp trong dải viền cho hết răng cưa của lưới 256x256.
    return blurBand(alpha, mask, width, height, Math.max(1, Math.round(k / 2)), dai);
}

/** Làm mờ hộp CHỈ trong dải viền, giữ nguyên vùng chắc chắn -> không làm nhoè thân người. */
function blurBand(alpha, mask, width, height, r, dai) {
    if (r < 1) return alpha;
    const out = new Float32Array(alpha);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const m = mask[i];
            if (m >= 0.9 || (dai ? !dai[i] : m <= 0.02)) continue;  // ngoài dải viền thì bỏ qua
            let s = 0, c = 0;
            const y0 = Math.max(0, y - r), y1 = Math.min(height - 1, y + r);
            const x0 = Math.max(0, x - r), x1 = Math.min(width - 1, x + r);
            for (let yy = y0; yy <= y1; yy++) {
                const row = yy * width;
                for (let xx = x0; xx <= x1; xx++) { s += alpha[row + xx]; c++; }
            }
            out[i] = s / c;
        }
    }
    return out;
}

/**
 * Ghép người lên nền mới.
 * @param {HTMLImageElement|HTMLCanvasElement} source ảnh gốc
 * @param {Float32Array} mask mask thô từ personSegmenter (0..1)
 * @param {[number,number,number]} newBg màu nền mới
 * @returns {HTMLCanvasElement}
 */
export async function composeOnBackground(source, mask, width, height, newBg, onTienDo, tuyChon = {}) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, width, height);

    const img = ctx.getImageData(0, 0, width, height);
    const px = img.data;

    if (onTienDo) onTienDo('Đang dò nền cũ…');
    const oldBg = estimateOldBackground(px, mask, width, height);
    await nhaLuong();

    // Có ảnh nền trống -> vẽ nó về ĐÚNG cỡ đang xử lý rồi đối chiếu. Người gọi phải đưa vào ảnh
    // đã cắt bằng catTheoKhung() với cùng khung, ở đây chỉ còn việc đưa về cùng số pixel.
    let nen = null;
    if (tuyChon.plate) {
        if (onTienDo) onTienDo('Đang đối chiếu ảnh nền trống…');
        const pc = document.createElement('canvas');
        pc.width = width;
        pc.height = height;
        const pctx = pc.getContext('2d', { willReadFrequently: true });
        pctx.imageSmoothingQuality = 'high';
        pctx.drawImage(tuyChon.plate, 0, 0, width, height);
        nen = chuanBiNenTrong(pctx.getImageData(0, 0, width, height).data, px, mask, width, height);
        // Không khớp thì BỎ, quay về cách một-màu-chung. Dùng cố ảnh nền sai sẽ hỏng toàn ảnh
        // chứ không riêng viền, tệ hơn hẳn so với không dùng.
        if (nen.loi) console.warn('[idPhoto] bỏ ảnh nền trống: ' + nen.loi);
        if (tuyChon.onChanDoan) tuyChon.onChanDoan(nen);
        await nhaLuong();
    }
    const dungNen = nen && !nen.loi ? nen : null;

    if (onTienDo) onTienDo('Đang xử lý viền tóc…');
    const alpha = refineAlpha(px, mask, width, height, oldBg, dungNen);
    await nhaLuong();

    if (onTienDo) onTienDo('Đang ghép nền mới…');
    const [nr, ng, nb] = newBg;


    // Chia lô theo HÀNG và nhả luồng giữa các lô -> spinner vẫn quay, khách biết máy đang chạy.
    const HANG_MOI_LO = 64;
    for (let y0 = 0; y0 < height; y0 += HANG_MOI_LO) {
        const y1 = Math.min(height, y0 + HANG_MOI_LO);
        for (let i = y0 * width; i < y1 * width; i++) {
        const a = alpha[i];
        const p = i * 4;

        // Đặt cả độ đục: pixel ngoài ảnh gốc (góc trống sau khi cropToIdPhoto xoay thẳng đầu) vốn TRONG SUỐT,
        // chỉ đổi màu thì nó vẫn trong suốt -> xuất JPEG / in ra thành tam giác đen ở góc.
        if (a <= 0) { px[p] = nr; px[p + 1] = ng; px[p + 2] = nb; px[p + 3] = 255; continue; }

        let r = px[p], g = px[p + 1], b = px[p + 2];

        // KHỬ ÁM MÀU. Pixel quan sát được C = a*F + (1-a)*B, đảo ngược để lấy F thật.
        //
        // CHIA CHO ALPHA ĐÃ LÀM MƯỢT, KHÔNG PHẢI ALPHA TỪNG PIXEL. Đo được: chia cho alpha
        // thô là nguồn nhiễu hạt chính ở viền tóc — alpha nhiễu thì hệ số chia nhiễu, mà ở
        // dải a≈0,2 phép chia khuếch đại nhiễu 5 lần, ra đốm lấm tấm và sợi tóc bạc phếch.
        // Nhưng "còn bao nhiêu phần nền cũ ở vùng này" vốn là đại lượng TRƠN theo không gian,
        // nên dùng bản mượt cho phép chia là đúng bản chất. Ghép thì VẪN dùng alpha sắc gốc
        // nên độ nét của viền không mất gì.
        // Số đo trên 5 ảnh người thật (nhiễu tần số cao thêm vào so với ảnh gốc, trong dải viền):
        //   cộng + chia alpha thô          4,05      <- bản đầu
        //   nhân + chia alpha thô          3,30
        //   nhân + chia alpha mượt r=12    0,37      <- bản này, giảm 91%
        // Ám màu nền cũ chỉ tăng 36,56 -> 37,60 (2,8%), rẻ hơn nhiều so với cách nâng thẳng
        // sàn lên 0,50 (nhiễu 0,35 nhưng ám màu vọt lên 40,35).
        // Viet lai F = (C - (1-a)B)/a thanh dang CONG:  F = C + (C-B)*(1-a)/a
        // Hai dang tuong duong ve toan, nhung dang nay lo ra he so khuech dai (1-a)/a de CHAN lai.
        //
        // VI SAO KHONG DUNG NGUONG: moi cach dat nguong (theo a hay theo alpha lam muot) deu la
        // quyet dinh NHI PHAN co/khong, ma quyet dinh do nhap nhay theo tung pixel -> chinh no la
        // mot nguon nhieu. Cong thuc nay lien tuc: o a=1 he so bang 0 nen RUOT KHONG BAO GIO BI DUNG
        // TOI, khong can nguong nao ca.
        //
        // Ban truoc cua toi chan theo alpha DA LAM MUOT, va do la LOI: pixel dac ruot (a>=0,98)
        // nam trong 12 px tinh tu duong bao co alpha muot ~0,7 nen bi khu am oan. Do duoc tren 5 anh
        // that: 2,4-4,0% dien tich anh bi lech mau trung binh 7,6-16,8/255 -> mot vanh mau sai chay
        // doc duong bao, nhin ra la anh bi bot bat.
        //
        // So do (nhieu tan so cao them vao / am mau con lai / lech mau o ruot - ruot PHAI la 0):
        //   khong chan          3,94 / 35,52 / 0,00
        //   CAP = 1             0,95 / 37,71 / 0,00   <- dang dung
        //   ban co loi truoc    0,37 / 37,60 / 0,53   <- nhieu thap gia, doi bang viec pha ruot
        // CAP = 1 nghia la phep sua toi da bang muc ma a = 0,5 sinh ra.
        // Có ảnh nền trống thì B lấy ĐÚNG pixel đó, phép khử ám màu thành chính xác chứ không
        // còn là xấp xỉ quanh một màu trung bình — đây là chỗ hết sạch quầng sáng ở tóc.
        if ((oldBg || dungNen) && a > 0.02) {
            const t = i * 3;
            const bR = dungNen ? dungNen.nen[t] : oldBg[0];
            const bG = dungNen ? dungNen.nen[t + 1] : oldBg[1];
            const bB = dungNen ? dungNen.nen[t + 2] : oldBg[2];
            let hs = (1 - a) / a;
            if (hs > DESPILL_CAP) hs = DESPILL_CAP;
            r = r + (r - bR) * hs;
            g = g + (g - bG) * hs;
            b = b + (b - bB) * hs;
            r = r < 0 ? 0 : r > 255 ? 255 : r;
            g = g < 0 ? 0 : g > 255 ? 255 : g;
            b = b < 0 ? 0 : b > 255 ? 255 : b;
        }

        px[p]     = r * a + nr * (1 - a);
        px[p + 1] = g * a + ng * (1 - a);
        px[p + 2] = b * a + nb * (1 - a);
        px[p + 3] = 255;
        }
        await nhaLuong();
    }

    ctx.putImageData(img, 0, 0);
    return c;
}

// ---------------------------------------------------------------------------
// HÀM CẤP CAO — DÙNG CÁI NÀY, đừng gọi composeOnBackground trên ảnh gốc.
//
// BÀI HỌC ĐO ĐƯỢC (2026-09-06): gọi thẳng trên ảnh Canon 3984x2656 (10,6 triệu pixel)
// làm KHOÁ LUỒNG CHÍNH quá 90 giây và treo cả tab. Vòng lặp từng pixel bằng JS không kham nổi
// cỡ đó. Mà ảnh thẻ 3x4 cm ở 300 DPI chỉ là 354x472 px — in gấp đôi cho chắc cũng chỉ 708x944.
// Vậy nên: HẠ CỠ TRƯỚC, xử lý ở đúng cỡ đầu ra. 10,6 MP -> 0,67 MP là ít việc đi 16 lần.
const MAX_COMPOSE_EDGE = 1400; // chặn cứng: trên mức này thì mọi thao tác pixel đều quá đắt

/**
 * Thay nền, làm ở ĐÚNG CỠ ĐẦU RA.
 * @param {HTMLImageElement|HTMLCanvasElement} source ảnh (hoặc vùng đã cắt sẵn)
 * @param {(src:HTMLElement, w:number, h:number)=>Promise<{mask:Float32Array}>} segmentFn
 *        thường là (s,w,h) => segmentPerson(s, { outWidth: w, outHeight: h })
 * @param {{ outWidth:number, outHeight:number, background:[number,number,number],
 *           plate?:HTMLCanvasElement, onChanDoan?:Function }} opts
 *        plate = ảnh phông TRỐNG đã cắt bằng catTheoKhung() với ĐÚNG khung của ảnh có khách.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function replaceBackgroundAt(source, segmentFn, opts) {
    const bg = opts.background || [255, 255, 255];
    let w = Math.max(1, Math.round(opts.outWidth));
    let h = Math.max(1, Math.round(opts.outHeight));

    if (Math.max(w, h) > MAX_COMPOSE_EDGE) {
        const s = MAX_COMPOSE_EDGE / Math.max(w, h);
        console.warn('[idPhoto] cỡ yêu cầu %dx%d vượt trần %d px, hạ xuống %dx%d để không khoá luồng chính',
            w, h, MAX_COMPOSE_EDGE, Math.round(w * s), Math.round(h * s));
        w = Math.round(w * s);
        h = Math.round(h * s);
    }

    if (opts.onTienDo) opts.onTienDo('Đang tách người khỏi nền…');
    const { mask } = await segmentFn(source, w, h);
    await nhaLuong();
    return composeOnBackground(source, mask, w, h, bg, opts.onTienDo,
                               { plate: opts.plate, onChanDoan: opts.onChanDoan });
}
