/**
 * Detects transparent slots in a frame image.
 * @param {string} imageUrl - The URL of the frame image.
 * @returns {Promise<Array<{x: number, y: number, width: number, height: number, rotation: number}>>} - A promise resolving to an array of detected boxes in percentage.
 */
export const detectFrameSlots = (imageUrl) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = imageUrl;

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            const width = canvas.width;
            const height = canvas.height;
            const visited = new Uint8Array(width * height); // 0: unvisited, 1: visited
            const detectedBoxes = [];

            const getIndex = (x, y) => (y * width + x);

            // Scan pixels
            // Increased precision by scanning every 2nd pixel
            for (let y = 0; y < height; y += 2) {
                for (let x = 0; x < width; x += 2) {
                    const idx = getIndex(x, y);
                    // Check alpha (transparency)
                    if (!visited[idx] && data[idx * 4 + 3] < 50) {
                        // Found a hole! Start Flood Fill to find bounds
                        let minX = x, maxX = x, minY = y, maxY = y;
                        let pixelCount = 0;
                        const stack = [[x, y]];
                        visited[idx] = 1;

                        while (stack.length) {
                            const [cx, cy] = stack.pop();
                            pixelCount++;

                            if (cx < minX) minX = cx;
                            if (cx > maxX) maxX = cx;
                            if (cy < minY) minY = cy;
                            if (cy > maxY) maxY = cy;

                            // Check 4 neighbors
                            const neighbors = [
                                [cx + 1, cy], [cx - 1, cy],
                                [cx, cy + 1], [cx, cy - 1]
                            ];

                            for (const [nx, ny] of neighbors) {
                                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                    const nIdx = getIndex(nx, ny);
                                    // If transparent and not visited (using same threshold < 50)
                                    if (!visited[nIdx] && data[nIdx * 4 + 3] < 50) {
                                        visited[nIdx] = 1;
                                        stack.push([nx, ny]);
                                    }
                                }
                            }
                        }

                        // Ignore small noise (less than 0.1% of total area)
                        if (pixelCount > (width * height * 0.001)) {
                            // Expand box slightly (0.3%) to prevent white edges
                            const expansion = 0.3;

                            let xPct = (minX / width) * 100;
                            let yPct = (minY / height) * 100;
                            let wPct = ((maxX - minX) / width) * 100;
                            let hPct = ((maxY - minY) / height) * 100;

                            // Check squareness in PIXELS (independent of frame aspect ratio)
                            const wPx = maxX - minX;
                            const hPx = maxY - minY;
                            const pixelRatio = wPx / hPx;
                            const isSquare = pixelRatio > 0.85 && pixelRatio < 1.15;

                            detectedBoxes.push({
                                x: Math.max(0, xPct - expansion),
                                y: Math.max(0, yPct - expansion),
                                width: Math.min(100, wPct + (expansion * 2)),
                                height: Math.min(100, hPct + (expansion * 2)),
                                rotation: 0,
                                isSquare: isSquare // Add this flag
                            });
                        }
                    }
                }
            }

            // Sort boxes: Top-to-Bottom, Left-to-Right
            detectedBoxes.sort((a, b) => {
                // If Y is similar (within 5%), sort by X
                if (Math.abs(a.y - b.y) < 5) return a.x - b.x;
                return a.y - b.y;
            });

            resolve(detectedBoxes);
        };

        img.onerror = () => reject(new Error("Could not load image for analysis."));
    });
};
