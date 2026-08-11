// Tạo thumbnail (bản thu nhỏ) phía client bằng canvas -> Blob PNG (giữ trong suốt cho frame).
// Dùng cho: (1) lúc upload frame mới, (2) tạo bù cho frame cũ.
// Nguồn có thể là File (upload) hoặc URL ảnh (backfill từ Supabase).

const DEFAULT_MAX = 400; // cạnh dài tối đa của thumbnail (px)

function loadImage(source) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        let objectUrl = null;
        // URL khác origin (Supabase) cần crossOrigin để canvas không bị "tainted" -> toBlob mới chạy.
        if (typeof source === 'string') {
            img.crossOrigin = 'anonymous';
        }
        img.onload = () => resolve({ img, objectUrl });
        img.onerror = () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            reject(new Error('Không tải được ảnh để tạo thumbnail'));
        };
        if (typeof source === 'string') {
            img.src = source;
        } else {
            objectUrl = URL.createObjectURL(source);
            img.src = objectUrl;
        }
    });
}

// Trả về Blob PNG đã thu nhỏ. Ném lỗi nếu không tạo được (gọi bên ngoài nên bắt để fallback).
export async function makeThumbnailBlob(source, maxSize = DEFAULT_MAX) {
    const { img, objectUrl } = await loadImage(source);
    try {
        const srcW = img.naturalWidth || img.width;
        const srcH = img.naturalHeight || img.height;
        if (!srcW || !srcH) throw new Error('Ảnh rỗng');

        const scale = Math.min(1, maxSize / Math.max(srcW, srcH));
        const w = Math.max(1, Math.round(srcW * scale));
        const h = Math.max(1, Math.round(srcH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);

        return await new Promise((resolve, reject) => {
            canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error('toBlob trả về rỗng'))),
                'image/png',
            );
        });
    } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
}
