const sortBoxes = (boxes) => {
    const sortedByY = [...boxes].sort((a, b) => a.y - b.y);
    const rows = [];
    let currentRow = [];
    for (const box of sortedByY) {
        if (currentRow.length === 0) {
            currentRow.push(box);
        } else {
            if (Math.abs(box.y - currentRow[0].y) < 5) {
                currentRow.push(box);
            } else {
                rows.push(currentRow);
                currentRow = [box];
            }
        }
    }
    if (currentRow.length > 0) rows.push(currentRow);
    rows.forEach(row => row.sort((a, b) => a.x - b.x));
    return rows.flat();
};

const toPercentBox = (bounds, width, height, expansion = 0.15) => {
    const wPx = bounds.maxX - bounds.minX + 1;
    const hPx = bounds.maxY - bounds.minY + 1;
    const pixelRatio = wPx / hPx;

    return {
        x: Math.max(0, (bounds.minX / width) * 100 - expansion),
        y: Math.max(0, (bounds.minY / height) * 100 - expansion),
        width: Math.min(100, (wPx / width) * 100 + expansion * 2),
        height: Math.min(100, (hPx / height) * 100 + expansion * 2),
        rotation: 0,
        isSquare: pixelRatio > 0.85 && pixelRatio < 1.15,
        areaScore: wPx * hPx,
    };
};

const overlaps = (a, b) => {
    const ax2 = a.x + a.width;
    const ay2 = a.y + a.height;
    const bx2 = b.x + b.width;
    const by2 = b.y + b.height;
    const xOverlap = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
    const yOverlap = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
    const overlapArea = xOverlap * yOverlap;
    const minArea = Math.min(a.width * a.height, b.width * b.height);
    return minArea > 0 && overlapArea / minArea > 0.35;
};

const connectedComponents = (width, height, isTarget) => {
    const visited = new Uint8Array(width * height);
    const boxes = [];
    const getIndex = (x, y) => y * width + x;
    const minArea = width * height * 0.012;
    const maxArea = width * height * 0.55;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const startIndex = getIndex(x, y);
            if (visited[startIndex] || !isTarget(x, y)) continue;

            let minX = x;
            let maxX = x;
            let minY = y;
            let maxY = y;
            let pixelCount = 0;
            const stack = [[x, y]];
            visited[startIndex] = 1;

            while (stack.length) {
                const [cx, cy] = stack.pop();
                pixelCount += 1;
                if (cx < minX) minX = cx;
                if (cx > maxX) maxX = cx;
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;

                const neighbors = [
                    [cx + 1, cy],
                    [cx - 1, cy],
                    [cx, cy + 1],
                    [cx, cy - 1],
                ];

                for (const [nx, ny] of neighbors) {
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                    const nIdx = getIndex(nx, ny);
                    if (!visited[nIdx] && isTarget(nx, ny)) {
                        visited[nIdx] = 1;
                        stack.push([nx, ny]);
                    }
                }
            }

            const boxW = maxX - minX + 1;
            const boxH = maxY - minY + 1;
            const area = boxW * boxH;
            const fillRatio = pixelCount / area;
            const aspect = boxW / boxH;

            if (
                pixelCount >= minArea
                && pixelCount <= maxArea
                && fillRatio > 0.72
                && aspect > 0.35
                && aspect < 3.2
            ) {
                boxes.push({ minX, maxX, minY, maxY, pixelCount, area });
            }
        }
    }

    return boxes;
};

const downsampleImage = (img, maxSide = 900) => {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { canvas, ctx };
};

const detectTransparentSlots = (data, width, height) => connectedComponents(
    width,
    height,
    (x, y) => data[(y * width + x) * 4 + 3] < 80
).map((bounds) => toPercentBox(bounds, width, height, 0.2));

const detectLightRectSlots = (data, width, height) => {
    const edgeMarginX = Math.round(width * 0.035);
    const edgeMarginY = Math.round(height * 0.035);

    const components = connectedComponents(width, height, (x, y) => {
        if (x < edgeMarginX || x > width - edgeMarginX || y < edgeMarginY || y > height - edgeMarginY) return false;
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        if (a < 200) return false;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const brightness = (r + g + b) / 3;
        const saturation = max - min;

        return brightness > 182 && saturation < 42;
    });

    return components
        .map((bounds) => toPercentBox(bounds, width, height, 0.1))
        .filter((box, index, arr) => arr.findIndex((other) => overlaps(box, other)) === index);
};

const limitToExpectedCount = (boxes, expectedCount) => {
    const count = Number(expectedCount);
    if (!Number.isFinite(count) || count <= 0 || boxes.length <= count) return boxes;

    const selected = [...boxes]
        .sort((a, b) => (b.areaScore || b.width * b.height) - (a.areaScore || a.width * a.height))
        .slice(0, count)
        .map(({ areaScore, ...box }) => box);

    return sortBoxes(selected);
};

/**
 * Detects photo slots in a frame image. Supports both transparent PNG holes
 * and light/low-saturation placeholder rectangles.
 */
export const detectFrameSlots = (imageUrl, expectedCount = null) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = imageUrl;

        img.onload = () => {
            const { canvas, ctx } = downsampleImage(img);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const { data } = imageData;
            const { width, height } = canvas;

            const transparentBoxes = detectTransparentSlots(data, width, height);
            const lightBoxes = detectLightRectSlots(data, width, height);
            const boxes = lightBoxes.length >= transparentBoxes.length ? lightBoxes : transparentBoxes;

            resolve(limitToExpectedCount(sortBoxes(boxes), expectedCount));
        };

        img.onerror = () => reject(new Error('Could not load image for analysis.'));
    });
};
