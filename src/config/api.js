// Cấu hình URL API dùng chung cho toàn app — tránh lặp/khác biệt giữa các file.
//
// - API_URL: backend LOCAL của booth (Flask). Để rỗng = same-origin.
// - CLOUD_API_URL: backend CLOUD (Vercel/Supabase). Trong mọi bản build thật, VITE_CLOUD_API_URL
//   được set trong .env nên fallback dưới hầu như không dùng (chỉ áp dụng khi chạy dev không có env).

const isLocalHostname = typeof window !== 'undefined'
    && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export const API_URL = import.meta.env.VITE_API_URL || '';

export const CLOUD_API_URL = import.meta.env.VITE_CLOUD_API_URL
    || (isLocalHostname ? 'https://tomatophotobooth.vercel.app' : '');

// Tiện ích: ưu tiên cloud, fallback về local (dùng cho frames, upload...).
export const FRAME_API_URL = CLOUD_API_URL || API_URL;
