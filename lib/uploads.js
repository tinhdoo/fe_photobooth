// Kiểm tra dữ liệu ẩn danh trước khi ghi vào storage công khai (dùng chung cho các API upload/lượt chụp).
import { Buffer } from 'node:buffer';

// Mã lượt do kiosk sinh (crypto.randomUUID). Mã còn được ghép vào đường dẫn storage ('sessions/<uuid>.json',
// 'mobile/<uuid>/...') -> chỉ cho chữ, số, '-', '_' để không trỏ ra file khác ('../config/app...').
export const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

// Ảnh HEIF/AVIF cũng có hộp 'ftyp' ở byte 4 nhưng không phải video MP4. Kiosk không sinh ra loại này.
const ANH_FTYP = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis']);

// Loại file xác định bằng BYTE ĐẦU, không tin tên/kiểu do máy gửi: ai cũng upload được .html/.svg chạy script
// trên domain ảnh công khai (R2/Supabase) để lừa đảo nếu lấy đuôi theo tên file. Trả { ext, type } hoặc null.
export function sniffMedia(buffer) {
    const b = buffer || Buffer.alloc(0);
    const at = (offset, bytes) => bytes.every((v, i) => b[offset + i] === v);
    if (at(0, [0xff, 0xd8, 0xff])) return { ext: 'jpg', type: 'image/jpeg' };
    if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', type: 'image/png' };
    if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return { ext: 'webp', type: 'image/webp' };
    if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return { ext: 'webm', type: 'video/webm' };
    if (at(4, [0x66, 0x74, 0x79, 0x70])) { // 'ftyp'
        const brand = b.subarray(8, 12).toString('latin1').toLowerCase();
        if (ANH_FTYP.has(brand)) return null;
        return { ext: 'mp4', type: 'video/mp4' };
    }
    return null;
}
