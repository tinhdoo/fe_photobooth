// idCrop.js
// Cắt ảnh chân dung về đúng khuôn ảnh thẻ: xoay cho thẳng đầu, đặt chiều cao đầu và đường mắt
// đúng tỉ lệ. KHÔNG cần model mới — buildFaceFrame (đã dùng cho bộ lọc làm đẹp) trả sẵn
// anchors.head_top / anchors.chin / anchors.eyes_center / roll / localDown.

import { detectFaces } from '../faceFilter/engine/faceLandmarkerClient.js';

/**
 * Tỉ lệ chuẩn cho ảnh thẻ. Hai con số này quyết định ảnh "ra dáng ảnh thẻ" hay không:
 *  - HEAD_RATIO: chiều cao đầu (đỉnh đầu -> cằm) chiếm bao nhiêu phần chiều cao ảnh.
 *  - EYE_LINE:   đường mắt nằm ở đâu tính từ mép trên.
 * Đây là mức thông dụng cho ảnh hồ sơ; ảnh giấy tờ chính thức có quy định riêng theo từng loại.
 */
// SỐ ĐO, KHÔNG PHẢI ƯỚC LƯỢNG. Hai quy định này MÂU THUẪN nhau, chỉ giao ở một dải hẹp:
//   Quy định VN (Bộ Công an): ảnh 4x6 cm có mắt cách mép trên 2,4 cm / mép dưới 3,6 cm
//                             -> đường mắt đúng 40% chiều cao ảnh.
//   Chuẩn ICAO 9303         : đỉnh đầu đến cằm chiếm 70-80% chiều cao ảnh.
// Đo trên 247 ảnh booth thật: (mắt->cằm) / (chiều cao đầu) = 0,468 ± 0,033. Suy ra
//   lề trên = 40% - 0,532 x chiều_cao_đầu
// nên đầu 70% -> lề trên còn 2,7%; đầu 75% -> 0%; đầu 80% -> ÂM, tức cụt đỉnh đầu.
// => Giữ mắt ở 40% thì đầu TỐI ĐA ~70%. Đừng code cứng 75% hay 80%.
export const HEAD_RATIO = 0.68;   // trong dải an toàn 65-70%
export const EYE_LINE = 0.40;     // theo quy định VN, KHÔNG phải 0,44

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Tính khung cắt từ một khuôn mặt đã nhận diện.
 * @returns {{ centerX:number, centerY:number, cropH:number, cropW:number, roll:number }}
 *          toạ độ theo PIXEL ẢNH GỐC; cropW/cropH là kích thước khung cắt trước khi xoay.
 */
export function computeIdCrop(frame, outW, outH) {
    const { anchors, roll, localDown } = frame;
    const headH = dist(anchors.head_top, anchors.chin);

    // Chiều cao khung cắt suy ngược từ tỉ lệ đầu mong muốn.
    const cropH = headH / HEAD_RATIO;
    const cropW = cropH * (outW / outH);

    // Đặt đường mắt đúng chỗ: tâm khung nằm dưới mắt một đoạn (0.5 - EYE_LINE) * cropH,
    // đo dọc theo trục "xuống" của ĐẦU (đã xoay theo roll) chứ không phải trục y của ảnh —
    // nếu dùng trục ảnh thì đầu nghiêng sẽ bị lệch khung.
    const k = (0.5 - EYE_LINE) * cropH;
    const centerX = anchors.eyes_center.x + localDown.x * k;
    const centerY = anchors.eyes_center.y + localDown.y * k;

    return { centerX, centerY, cropH, cropW, roll };
}

/**
 * Cắt + xoay thẳng ảnh về khuôn ảnh thẻ.
 * @param {HTMLImageElement|HTMLCanvasElement} img
 * @param {number} outW, outH kích thước ảnh ra (px)
 * @returns {Promise<{ canvas: HTMLCanvasElement, coFace: boolean }>}
 *          coFace=false nghĩa là KHÔNG tìm thấy mặt -> đã cắt giữa theo tỉ lệ, cần báo cho khách.
 */
export async function cropToIdPhoto(img, outW, outH, opts = {}) {
    // khongPhongTo: nếu khung cắt nhỏ hơn cỡ yêu cầu thì HẠ cỡ đầu ra xuống đúng cỡ thật,
    // thay vì kéo giãn. Phóng to ở đây rồi thu nhỏ lại lúc xếp vào ô in là lấy mẫu HAI lần,
    // lần nào cũng mất nét, mà không thêm được một chi tiết nào. Ô lớn nhất trên tờ 4x6 chỉ
    // là 472x709 px nên cỡ 708x944 vốn đã dư; hạ xuống không mất gì.
    // Đổi outW/outH cùng một tỉ lệ KHÔNG làm lệch khung cắt: computeIdCrop chỉ dùng chúng để
    // lấy TỈ LỆ (cropW = cropH * outW/outH), nên vùng cắt giữ nguyên, chỉ canvas ra nhỏ đi.
    const khongPhongTo = opts.khongPhongTo !== false;

    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;

    let det = null;
    try {
        det = await detectFaces(img);
    } catch (e) {
        console.warn('[idCrop] không nhận diện được khuôn mặt:', e);
    }

    const faces = det && det.faces ? det.faces : [];

    if (!faces.length) {
        // Không thấy mặt -> cắt giữa theo tỉ lệ, để khách vẫn có ảnh và tự kéo chỉnh sau.
        const srcRatio = srcW / srcH;
        const outRatio = outW / outH;
        let sw, sh;
        if (srcRatio > outRatio) { sh = srcH; sw = sh * outRatio; }
        else { sw = srcW; sh = sw / outRatio; }
        const caoRa = khongPhongTo ? Math.min(outH, sh) : outH;
        const khung = {
            kieu: 'giua', sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh,
            w: Math.max(1, Math.round(outW * (caoRa / outH))), h: Math.max(1, Math.round(caoRa)),
        };
        return { canvas: catTheoKhung(img, khung), khung, coFace: false,
                 scale: khung.h / sh, phongDaiCanThiet: outH / sh, headH: null };
    }

    // Nhiều mặt -> lấy mặt TO NHẤT (người đứng chụp, không phải người đi ngang phía sau).
    let frame = faces[0];
    for (const f of faces) {
        if (f.faceWidth * f.faceHeight > frame.faceWidth * frame.faceHeight) frame = f;
    }

    const { centerX, centerY, cropH, roll } = computeIdCrop(frame, outW, outH);

    // Kẹp ở 1: khung cắt nhỏ hơn cỡ yêu cầu thì canvas ra nhỏ theo, KHÔNG kéo giãn.
    const caoRa = khongPhongTo ? Math.min(outH, cropH) : outH;
    const scale = caoRa / cropH;
    const khung = {
        kieu: 'mat', centerX, centerY, roll, scale,
        w: Math.max(1, Math.round(outW * (caoRa / outH))), h: Math.max(1, Math.round(caoRa)),
    };
    const c = catTheoKhung(img, khung);

    // phongDaiCanThiet > 1 nghĩa là ảnh gốc KHÔNG đủ pixel để lấp kín cỡ yêu cầu. Với
    // khongPhongTo thì ta không kéo giãn nữa (scale bị kẹp ở 1), nhưng vẫn phải trả con số này
    // ra để nơi gọi biết ảnh vào thiếu nét và cảnh báo, thay vì đoán mò.
    // Ngưỡng suy ra từ hai hằng số ở trên: cropH = headH / 0,68, muốn đủ pixel thì
    // cropH >= outH, tức chiều cao đầu trong ảnh gốc phải >= 0,68 * outH (944 px -> 642 px).
    return { canvas: c, khung, coFace: true, scale,
             phongDaiCanThiet: outH / cropH, headH: cropH * HEAD_RATIO };
}

/**
 * Vẽ MỘT ảnh bất kỳ qua ĐÚNG khung cắt đã tính.
 *
 * Lý do tồn tại: để cắt ảnh NỀN TRỐNG (chụp phông không có người) y hệt ảnh có khách. Phép trừ
 * nền theo từng pixel chỉ đúng khi hai ảnh khớp nhau đến dưới một pixel — mà chỗ ta cần nó nhất
 * lại là viền tóc, đúng chỗ lệch nửa pixel đã đủ làm hỏng. Vì vậy cả hai ảnh PHẢI đi qua chung
 * một hàm này, không được viết lại phép vẽ ở hai nơi.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} img
 * @param {{kieu:string, w:number, h:number}} khung do cropToIdPhoto trả về
 * @returns {HTMLCanvasElement}
 */
export function catTheoKhung(img, khung) {
    const c = document.createElement('canvas');
    c.width = khung.w;
    c.height = khung.h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (khung.kieu === 'giua') {
        ctx.drawImage(img, khung.sx, khung.sy, khung.sw, khung.sh, 0, 0, c.width, c.height);
    } else {
        ctx.save();
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate(-khung.roll);
        ctx.scale(khung.scale, khung.scale);
        ctx.drawImage(img, -khung.centerX, -khung.centerY);
        ctx.restore();
    }
    return c;
}
