// Ghi chú nhỏ dưới mỗi bố cục ở màn Chọn bố cục (vd "Hợp 1–2 người"). Admin sửa ở Cài đặt trên cloud, booth nhận qua
// CLOUD_SYNC_KEYS. Lưu ở configs.layout_notes dạng CHUỖI JSON {id bố cục: chữ}: backend booth cất cấu hình bằng str()
// nên object sẽ thành chuỗi kiểu Python, đọc lại không được.
export const GHI_CHU_TOI_DA = 40;

export function docGhiChuBoCuc(giaTri) {
    if (!giaTri) return {};
    try {
        const o = typeof giaTri === 'string' ? JSON.parse(giaTri) : giaTri;
        return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch {
        return {};
    }
}
