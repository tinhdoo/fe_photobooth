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

    // 3. Draw using 9-parameter drawImage
    ctx.drawImage(img, sx, sy, sWidth, sHeight, x, y, w, h);
};
