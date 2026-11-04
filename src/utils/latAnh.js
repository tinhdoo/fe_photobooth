// Lật gương ảnh vừa chụp (live view đã lật nên ảnh cũng phải lật cho khớp) -> objectURL JPEG.
// Trước 0.0.33 làm ở luồng giao diện: giải mã + vẽ ảnh Canon ~24 MP chặn màn hình vài trăm ms ngay lúc ảnh vừa
// về (Độ mượt: "Chụp → hiện ảnh" 2,5-3 s, đơ ở bước Chụp). Giờ làm trong Web Worker; máy không có Worker /
// OffscreenCanvas, hoặc worker lỗi / quá giờ, thì làm như cũ ở luồng giao diện.

const QUALITY = 0.95;
const WORKER_QUA_GIO_MS = 20000;

let worker = null;
let hong = false; // worker không chạy được trên máy này -> thôi, dùng cách cũ tới lần tải lại trang
let soViec = 0;
const dangCho = new Map();

function layWorker() {
    if (hong) return null;
    if (worker) return worker;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
        hong = true;
        return null;
    }
    try {
        worker = new Worker(new URL('./latAnh.worker.js', import.meta.url), { type: 'module' });
    } catch (e) {
        console.warn('[latAnh] Không tạo được worker, lật ở luồng giao diện:', e);
        hong = true;
        return null;
    }
    worker.onmessage = ({ data }) => {
        const viec = dangCho.get(data.id);
        if (!viec) return;
        dangCho.delete(data.id);
        clearTimeout(viec.hen);
        if (data.blob) viec.resolve(URL.createObjectURL(data.blob));
        else viec.reject(new Error(data.loi || 'Worker lật ảnh lỗi'));
    };
    worker.onerror = (ev) => {
        // Lỗi nạp / chạy script worker: mọi việc đang chờ rơi về cách cũ, các lần sau cũng vậy.
        console.warn('[latAnh] Worker lỗi, chuyển về luồng giao diện:', ev?.message || ev);
        hong = true;
        try { worker.terminate(); } catch { /* bỏ qua */ }
        worker = null;
        dangCho.forEach((v) => { clearTimeout(v.hen); v.reject(new Error('Worker lật ảnh hỏng')); });
        dangCho.clear();
    };
    return worker;
}

function latTrongWorker(url) {
    const w = layWorker();
    if (!w) return Promise.reject(new Error('Không có worker'));
    return new Promise((resolve, reject) => {
        soViec += 1;
        const id = soViec;
        const hen = setTimeout(() => {
            dangCho.delete(id);
            reject(new Error('Worker lật ảnh quá giờ'));
        }, WORKER_QUA_GIO_MS);
        dangCho.set(id, { resolve, reject, hen });
        // URL tương đối phải đổi sang tuyệt đối: trong worker nó tính theo địa chỉ file worker.
        w.postMessage({ id, url: new URL(url, window.location.href).href, quality: QUALITY });
    });
}

/** Cách cũ: lật bằng canvas ở luồng giao diện. */
export function latTrenGiaoDien(imageUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(img, 0, 0);
                canvas.toBlob((blob) => {
                    if (blob) resolve(URL.createObjectURL(blob));
                    else reject(new Error('Failed to create blob'));
                }, 'image/jpeg', QUALITY);
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = reject;
        img.src = imageUrl;
    });
}

/** Lật gương ảnh -> objectURL JPEG. Lỗi thì ném ra (bên gọi giữ ảnh gốc như trước). */
export async function latGuongAnh(imageUrl) {
    try {
        return await latTrongWorker(imageUrl);
    } catch (e) {
        if (!hong) console.warn('[latAnh] Lật trong worker lỗi, làm lại ở luồng giao diện:', e?.message || e);
        return latTrenGiaoDien(imageUrl);
    }
}
