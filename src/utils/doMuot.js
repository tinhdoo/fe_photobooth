// Đo độ mượt của một lượt khách trên booth (0.0.32): khách chạm tới lúc màn hình đổi mất bao lâu, giao diện đơ
// bao lần, các chặng chờ (chụp, ghép, in, ra QR) dài bao nhiêu, lỗi gì đã hiện. Gửi kèm meta_data.do_muot của
// POST /api/sessions sẵn có -> không thêm request, không thêm function Vercel. Admin xem ở Cài đặt > Thiết bị.
//
// Nhẹ: độ trễ chạm lấy từ PerformanceObserver('event') — Chrome tự đo sẵn, ta chỉ nhận số. Mỗi chặng giữ một
// biểu đồ tần suất cố định (ROI_TRE) chứ không giữ từng lần chạm; cuối lượt mới tính tóm tắt.
// Trang tải lại sau mỗi lượt (resetSession) -> trạng thái module = một lượt. Lượt đã vào chụp mà không lưu được
// lên cloud (lỗi, bỏ dở, trang tải lại vì lỗi) -> tóm tắt cất vào localStorage, gửi kèm lượt kế tiếp ở `truoc`.

const TEN_BUOC = {
    1: 'chao', 1.5: 'che_do', 2: 'bo_cuc', 2.5: 'so_to', 3: 'thanh_toan', 3.5: 'chuan_bi',
    4: 'chup', 5: 'chon_anh', 5.5: 'chinh_anh', 6: 'khung_in', 7: 'ket_qua', 8: 'anh_the',
};
// Ngưỡng trên (ms) của từng ô biểu đồ độ trễ chạm; ô cuối là "lâu hơn 2 s". Chrome chỉ báo lần chạm >= 16 ms,
// lần nhanh hơn rơi vào ô đầu.
export const ROI_TRE = [16, 32, 50, 75, 100, 150, 200, 300, 500, 1000, 2000];
const DUNG_MS = 200;       // tác vụ chặn giao diện lâu hơn mức này = khách thấy đơ
const TOI_DA_LOI = 15;
const TOI_DA_MAU_TG = 20;
const KHOA_CHO = 'DO_MUOT_CHO';
const TOI_DA_CHO = 5;

let daBat = false;
let buoc = 'chao';
let buocXaNhat = 0;
const lichBuoc = [{ t: 0, b: 'chao' }]; // mốc đổi chặng (performance.now) -> gán lần chạm đúng chặng lúc chạm
const cham = {};       // chặng -> { n: số lần chạm, h: biểu đồ, max }
const tuongTac = new Map(); // interactionId -> { b, ms } (gộp các sự kiện của cùng một lần chạm)
const dung = {};       // chặng -> { n, max } tác vụ > DUNG_MS
const thoiGian = {};   // tên -> [ms]
const dem = {};
const loi = [];
let daGui = false;
let soLoiLucGui = 0;

const bayGio = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const buocLuc = (t) => {
    for (let i = lichBuoc.length - 1; i >= 0; i--) if (lichBuoc[i].t <= t) return lichBuoc[i].b;
    return lichBuoc[0].b;
};
const oCham = (b) => (cham[b] ||= { n: 0, h: new Array(ROI_TRE.length + 1).fill(0), max: 0 });

function dongTuongTac() {
    // Đổ các lần chạm đã đo vào biểu đồ (đo xong thì không cần giữ từng lần nữa).
    for (const { b, ms } of tuongTac.values()) {
        const o = oCham(b);
        let i = ROI_TRE.findIndex((nguong) => ms <= nguong);
        if (i < 0) i = ROI_TRE.length;
        o.h[i] += 1;
        if (ms > o.max) o.max = ms;
    }
    tuongTac.clear();
}

export function batDo() {
    if (daBat || typeof window === 'undefined') return;
    daBat = true;

    // Số lần chạm theo chặng (mẫu số; lần nhanh dưới 16 ms Chrome không báo).
    window.addEventListener('pointerdown', () => { oCham(buoc).n += 1; }, { capture: true, passive: true });

    if (typeof PerformanceObserver !== 'undefined') {
        try {
            new PerformanceObserver((list) => {
                for (const e of list.getEntries()) {
                    if (!e.interactionId) continue;
                    const cu = tuongTac.get(e.interactionId);
                    if (!cu || e.duration > cu.ms) tuongTac.set(e.interactionId, { b: buocLuc(e.startTime), ms: Math.round(e.duration) });
                }
                if (tuongTac.size > 50) dongTuongTac();
            }).observe({ type: 'event', durationThreshold: 16, buffered: true });
        } catch { /* Chrome cũ: bỏ đo chạm */ }
        try {
            new PerformanceObserver((list) => {
                for (const e of list.getEntries()) {
                    if (e.duration < DUNG_MS) continue;
                    const b = buocLuc(e.startTime);
                    const o = (dung[b] ||= { n: 0, max: 0 });
                    o.n += 1;
                    o.max = Math.max(o.max, Math.round(e.duration));
                }
            }).observe({ type: 'longtask', buffered: true });
        } catch { /* không có longtask */ }
    }

    window.addEventListener('error', (e) => ghiLoi('js', e.message || e.error?.message));
    window.addEventListener('unhandledrejection', (e) => ghiLoi('js', e.reason?.message || String(e.reason || '')));
    window.addEventListener('pagehide', catLuotChuaGui);
}

export function datBuoc(step) {
    const b = TEN_BUOC[step] || String(step);
    if (b === buoc) return;
    buoc = b;
    lichBuoc.push({ t: bayGio(), b });
    if (typeof step === 'number' && step > buocXaNhat) buocXaNhat = step;
}

export function ghiThoiGian(ten, ms) {
    const ds = (thoiGian[ten] ||= []);
    if (ds.length < TOI_DA_MAU_TG && Number.isFinite(ms)) ds.push(Math.round(ms));
}

/** Bấm giờ một chặng chờ: const xong = batDauDo('ghep'); ...; xong(); */
export function batDauDo(ten) {
    const t0 = bayGio();
    return () => ghiThoiGian(ten, bayGio() - t0);
}

export function demSuKien(ten) {
    dem[ten] = (dem[ten] || 0) + 1;
}

export function ghiLoi(ma, chiTiet) {
    demSuKien(`loi_${ma}`);
    if (loi.length >= TOI_DA_LOI) return;
    loi.push({ b: buoc, m: ma, t: String(chiTiet || '').slice(0, 120), s: Math.round(bayGio() / 1000) });
}

function tomTat() {
    dongTuongTac();
    const buocTomTat = {};
    for (const [b, o] of Object.entries(cham)) {
        if (!o.n && !o.h.some(Boolean)) continue;
        // Lần chạm Chrome không báo (< 16 ms) nằm ở ô đầu.
        const daDo = o.h.reduce((a, x) => a + x, 0);
        const h = [...o.h];
        h[0] += Math.max(0, o.n - daDo);
        buocTomTat[b] = { h, max: o.max };
    }
    for (const [b, o] of Object.entries(dung)) {
        buocTomTat[b] = { ...(buocTomTat[b] || {}), dung: o.n, dung_max: o.max };
    }
    return {
        v: 1,
        buoc: buocTomTat,
        tg: { ...thoiGian },
        dem: { ...dem },
        loi: [...loi],
        tong_s: Math.round(bayGio() / 1000),
        xa_nhat: TEN_BUOC[buocXaNhat] || null,
    };
}

function docCho() {
    try {
        const ds = JSON.parse(localStorage.getItem(KHOA_CHO) || '[]');
        return Array.isArray(ds) ? ds : [];
    } catch {
        return [];
    }
}

/** Tóm tắt lượt này để gửi kèm meta_data (kèm các lượt hỏng trước đó chưa gửi được). */
export function chotDoMuot() {
    const ra = tomTat();
    const truoc = docCho();
    if (truoc.length) ra.truoc = truoc;
    return ra;
}

/** Gọi sau khi POST /api/sessions thành công: lượt này và các lượt chờ đã lên cloud. */
export function daGuiDoMuot() {
    daGui = true;
    soLoiLucGui = loi.length;
    try { localStorage.removeItem(KHOA_CHO); } catch { /* bỏ qua */ }
}

// Trang sắp tải lại / đóng: lượt đã vào chụp mà chưa lên cloud, hoặc có lỗi mới sau khi đã gửi -> cất lại.
function catLuotChuaGui() {
    const chuaGui = !daGui && buocXaNhat >= 3.5;
    const loiSauGui = daGui && loi.length > soLoiLucGui;
    if (!chuaGui && !loiSauGui) return;
    try {
        const ban = tomTat();
        if (loiSauGui) { ban.sau_luu = true; ban.loi = loi.slice(soLoiLucGui); ban.buoc = {}; ban.tg = {}; }
        ban.luc = new Date().toISOString();
        const ds = [...docCho(), ban].slice(-TOI_DA_CHO);
        localStorage.setItem(KHOA_CHO, JSON.stringify(ds));
    } catch { /* đầy bộ nhớ: bỏ */ }
}
