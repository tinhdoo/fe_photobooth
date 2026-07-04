/**
 * Draws an image onto a canvas context with behavior identical to CSS `object-fit: cover`.
 * Supports custom positioning via anchor points (0.0 to 1.0).
 *
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D context.
 * @param {HTMLImageElement|HTMLCanvasElement|HTMLVideoElement} img - The source image element.
 * @param {number} x - The x-coordinate in the destination canvas.
 * @param {number} y - The y-coordinate in the destination canvas.
 * @param {number} w - The width of the destination rectangle.
 * @param {number} h - The height of the destination rectangle.
 * @param {number} [anchorX=0.5] - Horizontal anchor point (0.0 = left, 0.5 = center, 1.0 = right).
 * @param {number} [anchorY=0.5] - Vertical anchor point (0.0 = top, 0.5 = center, 1.0 = bottom).
 */
export const drawImageCover = (ctx, img, x, y, w, h, anchorX = 0.5, anchorY = 0.5) => {
    // 1. Calculate Aspect Ratios
    // Source Image Ratio (width / height)
    const sRatio = img.width / img.height;
    // Destination Frame Ratio (width / height)
    const dRatio = w / h;

    // Variables for source rectangle (cropping)
    let sx, sy, sWidth, sHeight;

    // 2. Determine Crop Logic
    if (dRatio > sRatio) {
        // Destination is 'wider' than source (or source is too tall)
        // We match widths and crop height
        sWidth = img.width;
        sHeight = sWidth / dRatio;
        sx = 0;
        // sy = (img.height - sHeight) / 2; // Old Center
        sy = (img.height - sHeight) * anchorY;
    } else {
        // Destination is 'taller' than source (or source is too wide)
        // We match heights and crop width
        sHeight = img.height;
        sWidth = sHeight * dRatio;
        // sx = (img.width - sWidth) / 2; // Old Center
        sx = (img.width - sWidth) * anchorX;
        sy = 0;
    }

    // 3. Draw
    const targetW = Math.max(1, Math.round(w));
    const targetH = Math.max(1, Math.round(h));

    // Thu nhỏ MẠNH (>2x mỗi chiều) trong 1 bước bằng drawImage sẽ undersampling -> răng cưa/
    // rỗ pixel ("vỡ nét"), rõ nhất với ảnh máy ảnh lớn (R100 6000x4000) nhét vào ô vài trăm px.
    // Giải pháp: hạ dần theo bước halving, mỗi bước dùng nội suy chất lượng cao -> mượt như
    // bộ lọc nhiều tap. Không đổi kết quả vị trí/kích thước, chỉ cải thiện độ nét.
    if (sWidth > targetW * 2 || sHeight > targetH * 2) {
        // Bước 1: vừa trích vùng crop vừa hạ 2x ngay (tránh canvas tạm full-size 6000x4000 ~96MB
        // trên máy kiosk). Hạ 2x/bước với nội suy cao vẫn nét như bộ lọc nhiều tap.
        let curW = Math.max(targetW, Math.round(sWidth / 2));
        let curH = Math.max(targetH, Math.round(sHeight / 2));
        let tmp = document.createElement('canvas');
        tmp.width = curW;
        tmp.height = curH;
        let tctx = tmp.getContext('2d');
        tctx.imageSmoothingEnabled = true;
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, curW, curH);

        // Bước 2: tiếp tục halving cho tới khi còn <= 2x đích.
        while (curW > targetW * 2 && curH > targetH * 2) {
            const nextW = Math.max(targetW, Math.floor(curW / 2));
            const nextH = Math.max(targetH, Math.floor(curH / 2));
            const next = document.createElement('canvas');
            next.width = nextW;
            next.height = nextH;
            const nctx = next.getContext('2d');
            nctx.imageSmoothingEnabled = true;
            nctx.imageSmoothingQuality = 'high';
            nctx.drawImage(tmp, 0, 0, curW, curH, 0, 0, nextW, nextH);
            tmp = next;
            curW = nextW;
            curH = nextH;
        }

        // Bước 3: vẽ bản đã hạ vào ĐÍCH (tôn trọng transform/clip đang đặt trên ctx).
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(tmp, 0, 0, curW, curH, x, y, w, h);
        return;
    }

    // Đường thường: thu nhỏ nhẹ hoặc phóng to -> vẽ thẳng với nội suy chất lượng cao.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sWidth, sHeight, x, y, w, h);
};
