// Lật gương ảnh vừa chụp NGOÀI luồng giao diện (xem latAnh.js): tải -> giải mã -> lật -> nén JPEG đều ở đây.
self.onmessage = async ({ data }) => {
    const { id, url, quality } = data;
    let bmp = null;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Tải ảnh lỗi HTTP ${res.status}`);
        const blob = await res.blob();
        // from-image: xoay theo EXIF như thẻ <img> (cách lật cũ) -> máy ảnh đặt dọc vẫn ra đúng chiều.
        bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d');
        ctx.translate(bmp.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(bmp, 0, 0);
        const out = await c.convertToBlob({ type: 'image/jpeg', quality });
        self.postMessage({ id, blob: out });
    } catch (e) {
        self.postMessage({ id, loi: String(e?.message || e) });
    } finally {
        bmp?.close();
    }
};
