// Quản lý phiên đăng nhập trang admin (token + role).
// - Cloud (Vercel): đăng nhập qua /api/codes action=login -> lưu {token, role, ...} vào đây.
// - Local (booth): giữ cơ chế cũ (cờ 'isAuthenticated') để admin vào được KHÔNG cần mạng.

import { isLocalHost } from './runtime';

const KEY = 'ptb_auth';

const activeStore = () => {
    if (localStorage.getItem(KEY)) return localStorage;
    if (sessionStorage.getItem(KEY)) return sessionStorage;
    return null;
};

export function saveAuth(auth, remember) {
    const store = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    store.setItem(KEY, JSON.stringify(auth));
    other.removeItem(KEY);
    // tương thích cơ chế cũ (ProtectedRoute/localhost vẫn đọc cờ này)
    store.setItem('isAuthenticated', 'true');
    other.removeItem('isAuthenticated');
}

export function getAuth() {
    try {
        const raw = localStorage.getItem(KEY) || sessionStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function clearAuth() {
    [localStorage, sessionStorage].forEach((s) => {
        s.removeItem(KEY);
        s.removeItem('isAuthenticated');
    });
}

export function getToken() {
    return getAuth()?.token || null;
}

export function getRole() {
    return getAuth()?.role || null;
}

export function getDisplayName() {
    const a = getAuth();
    return a?.display_name || a?.username || '';
}

// Giải mã phần payload của token (chỉ để đọc exp phía client, KHÔNG dùng để xác thực).
function decodeExp(token) {
    try {
        let p = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
        while (p.length % 4) p += '=';
        return JSON.parse(atob(p))?.exp || null;
    } catch {
        return null;
    }
}

export function isAuthenticated() {
    const token = getToken();
    if (token) {
        const exp = decodeExp(token);
        if (exp && exp < Math.floor(Date.now() / 1000)) return false; // token hết hạn
        return true;
    }
    // Chỉ máy booth (localhost) được chấp nhận cờ cũ (đăng nhập offline, không có token).
    // Cloud (Vercel) BẮT BUỘC có token -> phiên admin cũ sau khi deploy sẽ phải đăng nhập lại.
    if (!isLocalHost()) return false;
    return localStorage.getItem('isAuthenticated') === 'true'
        || sessionStorage.getItem('isAuthenticated') === 'true';
}

// Header Authorization cho các request cần token. Rỗng nếu chưa đăng nhập (local/booth).
export function authHeader() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// Nhân viên (role 'staff') chỉ được vào mục Mã thanh toán. null/admin = full.
export function isStaffRole() {
    return getRole() === 'staff';
}
