// Trích thông báo lỗi từ axios error và LUÔN trả về string.
// Tránh render nhầm object (vd Vercel trả { error: { code, message } }) làm React child -> crash #31.
export function errorMessage(error, fallback = 'Đã xảy ra lỗi') {
    const data = error?.response?.data;
    const raw = data?.message ?? data?.error ?? error?.message;
    if (typeof raw === 'string' && raw.trim()) return raw;
    if (raw && typeof raw === 'object') {
        const inner = raw.message ?? raw.error ?? raw.hint ?? raw.details;
        if (typeof inner === 'string' && inner.trim()) return inner;
    }
    return fallback;
}
