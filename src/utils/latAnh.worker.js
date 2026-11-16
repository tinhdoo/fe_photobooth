// Lật gương ảnh vừa chụp NGOÀI luồng giao diện (xem latAnh.js): tải -> giải mã -> lật -> nén JPEG đều ở đây.
// Canvas để willReadFrequently = vẽ bằng CPU: canvas GPU phải đẩy ảnh 24 MP lên card đồ hoạ rồi đọc ngược về để nén,
// card đang vẽ màn hình nên live view đứng 0,3-1 s mỗi tấm (đo 16/11 trên máy dev, Intel UHD).
// Có `xem` ([cạnh dài px, ...]) thì làm thêm các bản nhỏ đã lật để màn Chụp hiện (ảnh Canon 24 MP hiện thẳng làm
// màn hình khựng 200-400 ms mỗi lần, và 9 ô ảnh nhỏ ở dải dưới mỗi ô giải mã nguyên 24 MP).
function banNho(nguon, canhDai) {
    const tiLe = Math.min(1, canhDai / Math.max(nguon.width, nguon.height));
    const c = new OffscreenCanvas(Math.max(1, Math.round(nguon.width * tiLe)), Math.max(1, Math.round(nguon.height * tiLe)));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(nguon, 0, 0, c.width, c.height);
    return c;
}

self.onmessage = async ({ data }) => {
    const { id, url, quality, xem = [] } = data;
    let bmp = null;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Tải ảnh lỗi HTTP ${res.status}`);
        const blob = await res.blob();
        // from-image: xoay theo EXIF như thẻ <img> (cách lật cũ) -> máy ảnh đặt dọc vẫn ra đúng chiều.
        bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.translate(bmp.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(bmp, 0, 0);
        // Bản nhỏ thu dần từ bản lớn hơn (đỡ răng cưa hơn thu thẳng từ 24 MP).
        const banXem = [];
        let nguon = c;
        for (const canh of [...xem].sort((a, b) => b - a)) {
            nguon = banNho(nguon, canh);
            banXem.push({ canh, blob: await nguon.convertToBlob({ type: 'image/jpeg', quality: 0.85 }) });
        }
        const out = await c.convertToBlob({ type: 'image/jpeg', quality });
        self.postMessage({ id, blob: out, xem: banXem });
    } catch (e) {
        self.postMessage({ id, loi: String(e?.message || e) });
    } finally {
        bmp?.close();
    }
};
