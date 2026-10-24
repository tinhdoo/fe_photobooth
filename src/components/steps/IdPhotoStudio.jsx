// IdPhotoStudio.jsx — BƯỚC 8, chỉ có trong luồng ảnh thẻ ("Ảnh thẻ của bạn").
// Hai bước trong cùng một màn (mỗi lúc khách chỉ làm một việc — dễ hiểu trên máy cảm ứng):
//   1. Chỉnh ảnh: chọn tấm ưng nhất, màu nền, chỉnh mặt (Làm đẹp / Gương mặt / Xoá mụn — cùng bộ máy với bước 5.5,
//      KHÔNG có Trang điểm / Màu ảnh: ảnh nộp hồ sơ phải giống người thật). Xem trước: mặt to.
//   2. Chọn khung & in: KHUNG ảnh thẻ (admin tải lên ở Quản lý khung > Ảnh thẻ, ô của từng khung admin dò / chỉnh).
//      Xem trước: nguyên tờ in. Ảnh nhỏ của khung chỉ vẽ khung + ô trống, không lặp mặt khách (rối mắt).
// Luồng này KHÔNG đi qua Chọn ảnh (5), Chỉnh ảnh (5.5) và Chỉnh sửa (6) — các màn đó dành cho ảnh chơi.
//
// Thứ tự xử lý MỘT ô: cắt về khuôn (idCrop) -> tách nền (backend BiRefNet...) -> ghép màu nền -> chỉnh mặt
// (renderEdit) -> rải vào các ô của tờ + phủ khung (toAnhThe). Chỉnh mặt làm SAU khi ghép nền vì bóp mặt (warp)
// làm xê dịch viền người: làm trước thì mask tách nền không còn khớp. Nền là một màu phẳng nên warp không lộ.
// Mặt dò một lần trên ảnh đã cắt (cùng cỡ với ảnh ghép) rồi dùng lại cho mọi lần chỉnh.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useWorkflow } from '../../context/WorkflowContext';
import { API_URL, FRAME_API_URL } from '../../config/api';
import { cropToIdPhoto } from '../../idPhoto/idCrop';
import { tachNenAnhThe } from '../../idPhoto/tachNenBackend';
import { replaceBackgroundAt, BACKGROUNDS } from '../../idPhoto/replaceBackground';
import { KIEU_TO_ANH_THE, dungToAnhThe } from '../../idPhoto/toAnhThe';
import { luuLuotAnhThe } from '../../idPhoto/luuLuotCloud';
import {
    SLIDER_TABS, EMPTY_EDIT, editFromPreset, sliderValue, setEditValue, isNeutral, editKey,
    addSpot, popSpot, clearSpots, MAX_SPOTS,
} from '../../faceFilter/ai/photoEditState';
import { Loader2, Printer, ArrowLeft, ArrowRight, AlertTriangle, Eye, ChevronLeft, ChevronRight, Undo2, X, User, Check } from 'lucide-react';

// Cỡ MỘT ô ảnh thẻ khi xử lý. Ô 3x4 cm ở 300 DPI là 354x472 px; nhân đôi cho nét khi in.
// KHÔNG xử lý ở cỡ ảnh gốc: đo được ảnh Canon 3984x2656 làm khoá luồng chính hơn 90 giây.
const CELL_W = 708;
const CELL_H = 944;

// Hết giờ phiên: tự in ngay khi ảnh xử lý xong. Xử lý treo / in lỗi mà không ai bấm gì -> sau từng này tự về
// trang chủ, không để booth đứng mãi ở màn này (khách đã trả tiền rồi bỏ đi).
const HET_GIO_VE_NHA_MS = 3 * 60 * 1000;
const HAN_TAI_KHUNG_MS = 10000;

// Chỉ phần chỉnh mặt của bước 5.5; bỏ Trang điểm + Màu ảnh (ảnh thẻ nộp hồ sơ).
const TABS_MAT = SLIDER_TABS.filter((t) => t.id === 'beauty' || t.id === 'shape' || t.id === 'heal');
const NORMAL = { id: 'normal', name: 'Gốc', def: null };
const SPOT_R = 0.03;          // bán kính chấm xoá mụn = 3% bề rộng mặt gần nhất (như bước 5.5)
const SPOT_R_NO_FACE = 0.012;
const KHUNG_MOI_TRANG = 6;

const KHONG_KHUNG = { id: 'none', ten: 'Không khung', layoutId: KIEU_TO_ANH_THE[0]?.id, url: null, thumb: null, boxes: null };

const RANGE_CSS = `
.pe-range{-webkit-appearance:none;appearance:none;width:100%;height:10px;border-radius:999px;background:#ead8bd;outline:none;touch-action:none}
.pe-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:30px;height:30px;border-radius:50%;background:#7B5E43;border:4px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25)}
`;

const taoMa = () => (window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);

const taiAnh = (url) => new Promise((ok, loi) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => ok(img);
    img.onerror = () => loi(new Error('không nạp được ảnh'));
    img.src = url;
});

const coHan = (promise, ms, ten) => Promise.race([
    promise,
    new Promise((_, loi) => setTimeout(() => loi(new Error(`${ten} quá ${Math.round(ms / 1000)} giây`)), ms)),
]);

const layoutCua = (khung) => KIEU_TO_ANH_THE.find((l) => l.id === khung?.layoutId) || KIEU_TO_ANH_THE[0];
// Ô của một khung: cấu hình admin đã đục lỗ / chỉnh (nạp lúc tải danh sách), chưa có thì theo ô mặc định (id_photo_mixed).
const oCua = (khung) => (khung?.boxes?.length ? khung.boxes : layoutCua(khung).boxes);

// Kiểu có sẵn của bước 5.5 nhưng chỉ giữ phần làm đẹp da / gương mặt.
const chiLamDep = (def) => (def ? { ...def, makeup: {}, color: {} } : null);

const faceBox = (f) => {
    const xs = f.rings.faceOval.map((p) => p.x), ys = f.rings.faceOval.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

/** Đặt con vừa khít chỗ trống theo CẢ rộng lẫn cao, giữ tỉ lệ (ratio = rộng / cao) — không đẩy cột bên cạnh. */
function Fit({ ratio, children }) {
    return (
        <div className="relative min-h-0 w-full min-w-0 flex-1" style={{ containerType: 'size' }}>
            <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ width: `min(100cqw, calc(100cqh * ${ratio}))`, aspectRatio: String(ratio) }}
            >
                {children}
            </div>
        </div>
    );
}

/** Ảnh thu nhỏ một khung: ô trống (hình người) đúng vị trí ô của khung + PNG khung phủ lên. */
function KhungNho({ khung }) {
    return (
        <div className="relative h-full w-full overflow-hidden rounded-sm bg-white shadow ring-1 ring-black/5">
            {oCua(khung).filter((b) => b.type !== 'qr').map((b, i) => (
                <div
                    key={i}
                    className="absolute flex items-end justify-center overflow-hidden bg-[#e4dccf]"
                    style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.width}%`, height: `${b.height}%`, transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined }}
                >
                    <User className="h-[80%] w-[80%] translate-y-[18%] text-[#cfc4b3]" />
                </div>
            ))}
            {khung.thumb && <img src={khung.thumb} alt="" className="absolute inset-0 h-full w-full" draggable={false} />}
        </div>
    );
}

const IdPhotoStudio = () => {
    const { sessionData, updateSessionData, nextStep, prevStep, timedOut, resetSession, configs } = useWorkflow();

    const anhDaChup = useMemo(() => {
        const ds = sessionData.capturedPhotos?.length ? sessionData.capturedPhotos : sessionData.photos;
        // Luồng chụp lưu ảnh ở HAI dạng: chuỗi URL (hot folder) và object {id, url, videoUrl}
        // (webcam + canon, vì còn phải mang theo video motion). Bóc lấy URL ngay tại đây để cả
        // pipeline lẫn ô ảnh nhỏ chọn tấm bên dưới đều dùng được — gán thẳng object vào img.src
        // thì trình duyệt đổi thành chuỗi "[object Object]" rồi báo onerror. Cùng cách với
        // getPhotoUrl() trong Review.jsx.
        return (ds || []).map((p) => (typeof p === 'string' ? p : p?.url)).filter(Boolean);
    }, [sessionData.capturedPhotos, sessionData.photos]);

    const [chonAnh, setChonAnh] = useState(0);
    const [chonNen, setChonNen] = useState('blue');
    const [dangXuLy, setDangXuLy] = useState(false);
    const [tienDo, setTienDo] = useState('');
    const [canhBao, setCanhBao] = useState('');
    const [dangIn, setDangIn] = useState(false);
    const [giayCho, setGiayCho] = useState(0);
    const [buoc, setBuoc] = useState(1);                    // 1 = Chỉnh ảnh, 2 = Chọn khung & in
    const [tab, setTab] = useState('beauty');
    const [dsKhung, setDsKhung] = useState([KHONG_KHUNG]);
    const [chonKhung, setChonKhung] = useState('none');
    const [trangKhung, setTrangKhung] = useState(0);
    const [edits, setEdits] = useState({});                 // src -> edit (photoEditState.js)
    const [presets, setPresets] = useState([NORMAL]);
    const [engineReady, setEngineReady] = useState(false);
    const [xemGoc, setXemGoc] = useState(false);
    const [matCua, setMatCua] = useState({});               // src -> khung bao mặt (chuẩn hoá) cho xoá mụn
    const [coAnhIn, setCoAnhIn] = useState(false);          // ketQuaRef đã có ảnh (để tự in khi hết giờ)
    const daIn = !!sessionData.printedSessionId;

    const src = anhDaChup[chonAnh];
    const edit = (src && edits[src]) || EMPTY_EDIT;
    const khung = dsKhung.find((k) => k.id === chonKhung) || KHONG_KHUNG;

    const anhLonRef = useRef(null);   // canvas ảnh lớn (một ô)
    const toRef = useRef(null);       // canvas tờ in xem trước
    const ketQuaRef = useRef(null);   // canvas MỘT ô đã xử lý xong (đã chỉnh mặt), dùng để dựng tờ in
    const dangInRef = useRef(false);  // chặn bấm In hai lần trước khi state kịp cập nhật
    const tuInRef = useRef(false);    // đã tự in vì hết giờ (chỉ một lần)
    // Ảnh đã cắt + mask theo TỪNG tấm. Tách nền bằng BiRefNet mất 5-20 s nên đổi màu nền / khung / chỉnh mặt chỉ
    // làm lại phần sau, không tách lại. Lưu Promise chứ không lưu kết quả: đổi khi đang tách thì chờ chung lượt cũ.
    const tachRef = useRef(new Map());
    const tachXongRef = useRef(new Set()); // src đã cắt + tách nền xong (khỏi hiện màn chờ khi chỉ đổi nền / chỉnh mặt)
    const ghepRef = useRef(new Map());   // `${src}|${nền}` -> Promise<canvas đã ghép nền>
    const matRef = useRef(new Map());    // src -> Promise<faces>
    const khungAnhRef = useRef(new Map()); // url khung -> Promise<Image>
    const engineRef = useRef(null);
    const mountedRef = useRef(true);
    const latestRef = useRef({});
    const busyRef = useRef(false);
    const dirtyRef = useRef(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // Đếm giây chờ cho khách đỡ sốt ruột (BiRefNet có thể tới 20 s).
    useEffect(() => {
        if (!dangXuLy) return undefined;
        setGiayCho(0);
        const t = setInterval(() => setGiayCho((g) => g + 1), 1000);
        return () => clearInterval(t);
    }, [dangXuLy]);

    // Bộ chỉnh mặt (kéo theo MediaPipe) nạp ngầm; chưa xong thì ảnh vẫn in được, chỉ chưa chỉnh mặt.
    useEffect(() => {
        let alive = true;
        import('../../faceFilter/ai/applyBeauty.js')
            .then(async (mod) => {
                if (!alive) return;
                engineRef.current = mod;
                setEngineReady(true);
                const list = await mod.loadBeautyPresets();
                if (alive) setPresets([NORMAL, ...list.map((def) => ({ id: def.id, name: def.name, def: chiLamDep(def) }))]);
            })
            .catch((e) => console.error('[IdPhotoStudio] Không nạp được bộ chỉnh mặt:', e));
        return () => { alive = false; };
    }, []);

    // Khung ảnh thẻ trên cloud + cấu hình ô của từng khung (đục lỗ / chỉnh ở admin, như khung photobooth). Lỗi /
    // mất mạng thì vẫn còn "Không khung"; khung không tải được cấu hình thì dùng ô mặc định.
    useEffect(() => {
        let alive = true;
        Promise.all(KIEU_TO_ANH_THE.map((l) => axios
            .get(`${FRAME_API_URL}/api/frames`, { params: { layout: l.id }, timeout: 15000 })
            .then((r) => (Array.isArray(r.data) ? r.data : []))
            .catch((e) => { console.warn('[IdPhotoStudio] tải khung', l.id, 'lỗi:', e?.message || e); return []; })))
            .then((theoKieu) => {
                if (!alive) return;
                const ds = theoKieu.flat().filter((f) => f && f.url).map((f) => ({
                    id: `${f.layout}/${f.name}`,
                    ten: String(f.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '),
                    layoutId: f.layout,
                    url: f.url,
                    thumb: f.thumb_url || f.url,
                    tenFile: f.name,
                    boxes: null,
                }));
                return Promise.all(ds.map((k) => axios
                    .get(`${FRAME_API_URL}/api/frames`, { params: { layout: k.layoutId, name: k.tenFile, resource: 'config' }, timeout: 8000 })
                    .then((r) => (Array.isArray(r.data?.boxes) && r.data.boxes.length ? { ...k, boxes: r.data.boxes } : k))
                    .catch(() => k)));
            })
            .then((ds) => { if (alive && ds) setDsKhung([KHONG_KHUNG, ...ds]); });
        return () => { alive = false; };
    }, []);

    const anhKhung = useCallback((k) => {
        if (!k?.url) return Promise.resolve(null);
        const bo = khungAnhRef.current;
        if (!bo.has(k.url)) {
            const p = taiAnh(k.url);
            bo.set(k.url, p);
            p.catch(() => bo.delete(k.url));
        }
        return bo.get(k.url);
    }, []);

    /** Cắt về khuôn + tách nền cho một tấm, nhớ lại theo src. Lỗi thì xoá khỏi bộ nhớ để lần sau thử lại. */
    const chuanBiAnh = useCallback((s) => {
        const bo = tachRef.current;
        if (!bo.has(s)) {
            const p = (async () => {
                const img = await taiAnh(s);
                // 1. Cắt về khuôn ảnh thẻ (xoay thẳng đầu, canh theo mắt/cằm)
                const { canvas: daCat, coFace, phongDaiCanThiet } = await cropToIdPhoto(img, CELL_W, CELL_H);
                // 2. Tách người (backend BiRefNet -> PP-MattingV2 -> MediaPipe), ở đúng cỡ ảnh đã cắt
                const tach = await tachNenAnhThe(daCat, daCat.width, daCat.height,
                    (m) => { if (mountedRef.current) setTienDo(m); });
                console.info('[IdPhotoStudio] tách nền bằng', tach.nguon);
                return { daCat, coFace, phongDaiCanThiet, mask: tach.mask };
            })();
            bo.set(s, p);
            p.then(() => tachXongRef.current.add(s), () => bo.delete(s));
        }
        return bo.get(s);
    }, []);

    /** Ghép màu nền (refineAlpha + khử ám màu ở replaceBackground.js), nhớ theo tấm + màu. */
    const ghepNen = useCallback((s, nenId, prep) => {
        const key = `${s}|${nenId}`;
        const bo = ghepRef.current;
        if (!bo.has(key)) {
            const bg = BACKGROUNDS.find((b) => b.id === nenId) || BACKGROUNDS[0];
            const p = replaceBackgroundAt(prep.daCat, async () => ({ mask: prep.mask }), {
                // Bám theo cỡ THẬT của ảnh đã cắt, không ép về CELL_W/CELL_H. Khi ảnh gốc
                // nhỏ, cropToIdPhoto trả canvas nhỏ hơn; ép lên 708x944 ở đây là phóng to
                // lại đúng thứ vừa tránh, rồi lúc xếp vào ô in (lớn nhất 472x709) lại thu
                // nhỏ -> lấy mẫu ba lần. Ô in nhỏ hơn 708x944 nên hạ cỡ không mất gì.
                outWidth: prep.daCat.width,
                outHeight: prep.daCat.height,
                background: bg.rgb,
            });
            bo.set(key, p);
            p.catch(() => bo.delete(key));
        }
        return bo.get(key);
    }, []);

    /** Dò mặt trên ảnh đã cắt (một lần mỗi tấm). Lỗi -> không có mặt, vẫn in được. */
    const doMat = useCallback((s, prep) => {
        const bo = matRef.current;
        if (!bo.has(s)) {
            const p = engineRef.current.detectFacesOn(prep.daCat).catch((e) => {
                console.warn('[IdPhotoStudio] dò mặt lỗi:', e);
                return [];
            });
            p.then((faces) => { if (mountedRef.current) setMatCua((m) => ({ ...m, [s]: faces.map(faceBox) })); });
            bo.set(s, p);
        }
        return bo.get(s);
    }, []);

    const veVao = (canvas, nguon) => {
        if (!canvas || !nguon) return;
        if (canvas.width !== nguon.width) canvas.width = nguon.width;
        if (canvas.height !== nguon.height) canvas.height = nguon.height;
        canvas.getContext('2d').drawImage(nguon, 0, 0);
    };

    // Vòng vẽ "mới nhất thắng" (như bước 5.5): đang vẽ mà khách kéo tiếp thì chỉ đánh dấu, vẽ xong lượt này vẽ
    // luôn trạng thái mới nhất — không xếp hàng từng nấc thanh trượt.
    const pump = useCallback(async () => {
        if (busyRef.current) { dirtyRef.current = true; return; }
        busyRef.current = true;
        try {
            do {
                dirtyRef.current = false;
                const cur = latestRef.current;
                if (!cur.src) break;
                let prep;
                const sanSang = tachXongRef.current.has(cur.src);
                if (!sanSang) { setDangXuLy(true); setTienDo('Đang chuẩn bị…'); }
                try {
                    prep = await chuanBiAnh(cur.src);
                } catch (e) {
                    console.error('[IdPhotoStudio]', e);
                    if (latestRef.current.src === cur.src) {
                        ketQuaRef.current = null;
                        setCanhBao('Xử lý ảnh lỗi: ' + e.message);
                    }
                    continue;
                } finally {
                    if (!sanSang) { setDangXuLy(false); setTienDo(''); }
                }
                if (!prep.coFace) setCanhBao('Không nhận ra khuôn mặt — ảnh đã được cắt giữa, có thể lệch.');
                // Ảnh gốc thiếu pixel: cropToIdPhoto đã hạ cỡ ra thay vì kéo giãn, nên ảnh không
                // bị mềm, nhưng đầu vào vẫn thiếu chi tiết -> báo để lần sau chụp gần hơn.
                else if (prep.phongDaiCanThiet > 1.15) {
                    setCanhBao('Ảnh gốc hơi nhỏ so với khuôn ảnh thẻ (thiếu ' +
                        Math.round((prep.phongDaiCanThiet - 1) * 100) + '% chiều cao) — nên chụp gần hơn để nét hơn.');
                } else setCanhBao('');

                const ghep = await ghepNen(cur.src, cur.nen, prep);
                let ra = ghep;
                if (engineRef.current && !cur.goc && !isNeutral(cur.edit)) {
                    const faces = await doMat(cur.src, prep);
                    try {
                        ra = engineRef.current.renderEdit(ghep, faces, cur.edit, ghep.width, ghep.height);
                    } catch (e) {
                        console.warn('[IdPhotoStudio] chỉnh mặt lỗi, giữ ảnh chưa chỉnh:', e);
                    }
                } else if (engineRef.current) {
                    doMat(cur.src, prep); // dò sẵn để khung mặt (xoá mụn) có ngay
                }
                const kAnh = await anhKhung(cur.khung).catch(() => null);
                const moiNhat = latestRef.current;
                if (moiNhat.src !== cur.src || moiNhat.nen !== cur.nen || moiNhat.edit !== cur.edit
                    || moiNhat.goc !== cur.goc || moiNhat.khung !== cur.khung) { dirtyRef.current = true; continue; }

                if (!cur.goc) { ketQuaRef.current = ra; setCoAnhIn(true); } // "xem ảnh chưa chỉnh" chỉ để nhìn, không đổi thứ sẽ in
                veVao(anhLonRef.current, ra);
                veVao(toRef.current, dungToAnhThe(ra, oCua(cur.khung), kAnh, 800, 1200));
                if (cur.khung?.url && !kAnh) setCanhBao('Không tải được khung này — tờ in sẽ không có khung.');
                await new Promise((r) => setTimeout(r, 0)); // cho sự kiện kéo thanh trượt kịp tới
            } while (dirtyRef.current);
        } catch (e) {
            console.error('[IdPhotoStudio]', e);
            setCanhBao('Xử lý ảnh lỗi: ' + e.message);
        } finally {
            busyRef.current = false;
        }
    }, [chuanBiAnh, ghepNen, doMat, anhKhung]);

    useEffect(() => {
        latestRef.current = { src, nen: chonNen, edit, goc: xemGoc, khung };
        pump();
    }, [src, chonNen, edit, xemGoc, khung, engineReady, pump]);

    // ---- chỉnh mặt ----
    const update = (fn) => {
        if (!src || daIn || dangIn) return;
        setEdits((p) => ({ ...p, [src]: fn(p[src] || EMPTY_EDIT) }));
    };
    const choosePreset = (p) => update((e) => ({ ...editFromPreset(p.def), spots: e.spots || [] }));
    const setValue = (s, v) => update((e) => setEditValue(e, s.group, s.key, v, 'all'));
    const spots = edit.spots || [];
    const currentTab = TABS_MAT.find((t) => t.id === tab);
    const presetBase = presets.find((p) => p.id === edit.presetId);
    const presetTouched = presetBase && editKey({ ...edit, spots: [] }) !== editKey(editFromPreset(presetBase.def));

    // Tab Xoá mụn: chạm lên ảnh lớn để đặt chấm (cỡ theo mặt gần nhất).
    const chamAnh = (ev) => {
        if (tab !== 'heal' || xemGoc || dangXuLy) return;
        const r = ev.currentTarget.getBoundingClientRect();
        const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
        if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
        const aspect = r.width / r.height;
        let rad = SPOT_R_NO_FACE, best = Infinity;
        (matCua[src] || []).forEach((bx) => {
            const d = Math.hypot(((bx.x0 + bx.x1) / 2 - x) * aspect, (bx.y0 + bx.y1) / 2 - y);
            if (d < best) { best = d; rad = Math.max(0.003, (bx.x1 - bx.x0) * aspect * SPOT_R); }
        });
        if (spots.length >= MAX_SPOTS) return;
        update((e) => addSpot(e, { x, y, r: rad }));
    };

    // Timeout / rớt kết nối KHÔNG có nghĩa là chưa in: backend nhận lệnh rồi mới xếp hàng. Hỏi lại danh sách lệnh
    // in trước khi báo lỗi (cùng cách Edit.jsx), kẻo khách bấm In lại ra tấm thứ hai.
    const daXepHangIn = async (ma) => {
        try {
            const res = await axios.get(`${API_URL}/api/print/jobs`, { params: { limit: 30 }, timeout: 8000 });
            return (Array.isArray(res.data) ? res.data : []).some((j) => j && j.session_uuid === ma && j.status !== 'failed');
        } catch {
            return false;
        }
    };

    const inAnh = async () => {
        if (dangInRef.current) return;
        const cell = ketQuaRef.current;
        if (!cell) { setCanhBao('Chưa có ảnh để in.'); return; }
        dangInRef.current = true;
        setDangIn(true);
        try {
            // Khung chưa tải xong thì chờ thêm chút; vẫn hỏng thì in tờ trắng (khách đã trả tiền, không kẹt ở đây).
            const k = latestRef.current.khung;
            const kAnh = k?.url ? await coHan(anhKhung(k), HAN_TAI_KHUNG_MS, 'Tải khung').catch(() => null) : null;
            const to = dungToAnhThe(cell, oCua(k), kAnh);
            // Mã lần in giữ trong sessionData: bấm In lại sau lỗi / quá giờ vẫn dùng mã cũ -> backend thấy mã đã có
            // lệnh chưa lỗi thì trả lại lệnh đó, không in tấm thứ hai (0.0.24). Cũng là mã album trong QR.
            let maLanIn = sessionData.printedSessionId || sessionData.printAttemptId;
            if (!maLanIn) {
                maLanIn = taoMa();
                updateSessionData('printAttemptId', maLanIn);
            }
            // Đã in ở lần trước (request quá giờ nhưng máy vẫn in, hoặc in xong mà lưu cloud lỗi) -> không gửi
            // lệnh in nữa, chỉ lưu lại.
            if (!sessionData.printedSessionId) {
                await guiLenhIn(to, k, maLanIn);
                updateSessionData('printedSessionId', maLanIn);
            }
            await luuVaSangKetQua(to, cell, maLanIn);
        } catch (e) {
            console.error('[IdPhotoStudio] in lỗi', e);
            const msg = e.response?.data?.error || e.message || 'không rõ';
            setCanhBao('Gửi lệnh in lỗi: ' + msg + (timedOut ? ' — máy sẽ tự về trang chủ sau ít phút.' : ''));
        } finally {
            dangInRef.current = false;
            setDangIn(false);
        }
    };

    const guiLenhIn = async (to, k, maLanIn) => {
        const blob = await new Promise((ok) => to.toBlob(ok, 'image/png'));
        const fd = new FormData();
        fd.append('file', blob, 'TomatoPhotobooth_anhthe.png');
        fd.append('copies', String(Math.max(1, parseInt(sessionData.printQuantity, 10) || 1)));
        fd.append('print_mode', layoutCua(k).printMode || sessionData.layout?.printMode || 'id_photo_4x6');
        fd.append('cut_mode', 'none');
        fd.append('session_id', maLanIn);

        try {
            await axios.post(`${API_URL}/api/print`, fd, { timeout: 60000 });
        } catch (e) {
            if (!e.response && await daXepHangIn(maLanIn)) return;
            throw e;
        }
    };

    // Sau khi in: lưu tờ in + bản ghi lượt lên cloud (QR album + Doanh thu), rồi sang Kết quả (7). Lỗi mạng thì ở lại
    // màn này: nút đổi thành "Lưu lại" (không in thêm), kèm "Kết thúc" như Edit.jsx.
    const luuVaSangKetQua = async (to, cell, maLanIn) => {
        let url;
        try {
            url = await luuLuotAnhThe({
                to,
                anh: cell,
                maLuot: maLanIn,
                sessionData,
                soTo: Math.max(1, parseInt(sessionData.printQuantity, 10) || 1),
            });
        } catch (e) {
            console.error('[IdPhotoStudio] lưu cloud lỗi', e);
            setCanhBao('Ảnh đã in xong nhưng chưa lưu được lên mạng nên chưa có mã QR (' + (e.message || 'lỗi mạng')
                + '). Bấm "Lưu lại" để thử lại — không in thêm tấm nào — hoặc "Kết thúc" để về trang chủ.');
            return;
        }
        updateSessionData('sessionId', maLanIn);
        updateSessionData('finalImage', url);
        nextStep(); // -> Kết quả (7)
    };

    // HẾT GIỜ PHIÊN: tự in tấm đang chọn với nền / khung / chỉnh mặt đang chọn ngay khi ảnh xử lý xong.
    useEffect(() => {
        if (!timedOut || dangXuLy || !coAnhIn || tuInRef.current) return;
        if (!ketQuaRef.current) return; // xử lý lỗi -> không có gì để in; hẹn giờ dưới đưa về trang chủ
        tuInRef.current = true;
        inAnh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timedOut, dangXuLy, coAnhIn]);

    // Chốt an toàn: hết giờ mà vẫn còn ở màn này (xử lý treo, in lỗi, không ai bấm) -> về trang chủ.
    // In xong thì đã sang Kết quả, màn này unmount -> hẹn giờ huỷ. Deps chỉ cờ hết giờ: resetSession đổi tham
    // chiếu mỗi giây (xem Result.jsx).
    useEffect(() => {
        if (!timedOut) return undefined;
        const t = setTimeout(() => { resetSession(); }, HET_GIO_VE_NHA_MS);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timedOut]);

    const soTrang = Math.max(1, Math.ceil(dsKhung.length / KHUNG_MOI_TRANG));
    const trang = Math.min(trangKhung, soTrang - 1);
    const khungTrang = dsKhung.slice(trang * KHUNG_MOI_TRANG, (trang + 1) * KHUNG_MOI_TRANG);
    const khoa = daIn || dangIn;

    const Buoc = ({ n, ten }) => (
        <div className={`flex items-center gap-2 ${buoc === n ? 'text-[#3F3127]' : 'text-[#7A5A3B]/50'}`}>
            <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-black ${buoc === n ? 'bg-[#e63946] text-white' : buoc > n ? 'bg-[#7B5E43] text-white' : 'bg-[#F6E6C9]'}`}>
                {buoc > n ? <Check size={16} strokeWidth={3} /> : n}
            </span>
            <span className="text-lg font-black">{ten}</span>
        </div>
    );
    const sangNen = (id) => id === 'white' || id === 'gray' || id === 'blue_light';

    return (
        <div
            className="relative flex h-full w-full flex-col overflow-hidden bg-[#FFF8E7] bg-cover bg-center px-6 py-4 text-[#7A5A3B]"
            style={{ backgroundImage: configs?.['bg_id-photo'] ? `url('${configs['bg_id-photo']}')` : 'none' }}
        >
            <style>{RANGE_CSS}</style>
            <header className="flex shrink-0 items-center justify-between pb-3">
                {/* Hết giờ hoặc đã in thì không cho chụp lại (hết giờ: màn Chụp đẩy thẳng về đây; đã in: tránh in lần 2). */}
                {!timedOut && !khoa ? (
                    <button
                        onClick={prevStep}
                        className="flex w-36 items-center gap-2 rounded-2xl border border-[#E7D3B7] bg-white px-4 py-2 text-sm font-bold active:scale-95"
                    >
                        <ArrowLeft size={18} /> Chụp lại
                    </button>
                ) : <div className="w-36" />}
                <div className="flex items-center gap-4">
                    <Buoc n={1} ten="Chỉnh ảnh" />
                    <span className="h-0.5 w-12 bg-[#D5B895]" />
                    <Buoc n={2} ten="Chọn khung & in" />
                </div>
                <div className="w-36" />{/* chỗ cho đồng hồ phiên (SessionTimer) */}
            </header>

            <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
                {/* TRÁI: MỘT khung xem trước — bước 1 mặt to, bước 2 nguyên tờ in. Cả hai canvas luôn gắn trong DOM
                    (chỉ ẩn) để vòng vẽ cập nhật được cả hai, chuyển bước không phải vẽ lại. */}
                <section className="flex min-h-0 min-w-0 flex-col items-center gap-2 rounded-[1.5rem] bg-white/75 p-4 shadow-[0_18px_55px_-35px_rgba(47,62,70,0.45)]">
                    <div className={`flex min-h-0 w-full flex-1 flex-col ${buoc === 1 ? '' : 'hidden'}`}>
                        <Fit ratio={CELL_W / CELL_H}>
                            <div className="relative h-full w-full" onPointerUp={chamAnh}>
                                <canvas ref={anhLonRef} className="block h-full w-full rounded-xl bg-[#ead8bd] shadow-md" />
                                {tab === 'heal' && !xemGoc && spots.map((sp, i) => (
                                    <div
                                        key={i}
                                        className="pointer-events-none absolute rounded-full border-2 border-dashed border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                                        style={{
                                            left: `${sp.x * 100}%`,
                                            top: `${sp.y * 100}%`,
                                            width: `${(2 * sp.r * CELL_H * 100) / CELL_W}%`,
                                            height: `${2 * sp.r * 100}%`,
                                            transform: 'translate(-50%, -50%)',
                                        }}
                                    />
                                ))}
                                {dangXuLy && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-white/85 px-3 text-center">
                                        <Loader2 className="animate-spin text-[#e63946]" size={36} />
                                        <span className="text-sm font-bold">{tienDo || 'Đang xử lý…'}</span>
                                        {giayCho >= 3 && <span className="text-xs text-gray-400">Đã {giayCho} giây</span>}
                                    </div>
                                )}
                            </div>
                        </Fit>
                    </div>
                    <div className={`flex min-h-0 w-full flex-1 flex-col ${buoc === 2 ? '' : 'hidden'}`}>
                        <Fit ratio={2 / 3}>
                            <div className="relative h-full w-full">
                                <canvas ref={toRef} className="block h-full w-full rounded-md bg-white shadow-lg ring-1 ring-black/5" />
                                {dangXuLy && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-white/85">
                                        <Loader2 className="animate-spin text-[#e63946]" size={36} />
                                        <span className="text-sm font-bold">{tienDo || 'Đang xử lý…'}</span>
                                    </div>
                                )}
                            </div>
                        </Fit>
                    </div>
                    {buoc === 1 ? (
                        <button
                            type="button"
                            onPointerDown={() => setXemGoc(true)}
                            onPointerUp={() => setXemGoc(false)}
                            onPointerLeave={() => setXemGoc(false)}
                            onPointerCancel={() => setXemGoc(false)}
                            onContextMenu={(e) => e.preventDefault()}
                            className="flex shrink-0 select-none items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm font-extrabold shadow-md active:bg-[#D5B895] active:text-white"
                            style={{ touchAction: 'none' }}
                        >
                            <Eye size={16} /> Giữ để xem ảnh chưa chỉnh
                        </button>
                    ) : null}
                </section>

                <section className="flex min-h-0 min-w-0 flex-col gap-4">
                    {buoc === 1 ? (
                        <>
                            {/* Tấm + màu nền trên một hàng */}
                            <div className="flex shrink-0 items-center gap-3 rounded-2xl bg-white/80 px-4 py-3 shadow-sm">
                                <span className="text-sm font-extrabold text-[#3F3127]">Tấm</span>
                                <div className="flex min-w-0 gap-2 overflow-hidden">
                                    {anhDaChup.map((s, i) => (
                                        <button
                                            key={i}
                                            onClick={() => setChonAnh(i)}
                                            // Đang tách nền thì chưa cho đổi tấm: backend xử lý từng lượt, bấm liên tục là dồn
                                            // hàng mấy lượt 10-20 s. Đổi màu nền / chỉnh mặt thì vẫn được.
                                            disabled={(dangXuLy && chonAnh !== i) || khoa}
                                            className={`relative h-14 w-11 shrink-0 overflow-hidden rounded-lg border-[3px] active:scale-95 disabled:opacity-40 ${chonAnh === i ? 'border-[#e63946]' : 'border-transparent opacity-60'}`}
                                        >
                                            <img src={s} alt={`Tấm ${i + 1}`} className="h-full w-full object-cover" />
                                            {!isNeutral(edits[s]) && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#e63946]" />}
                                        </button>
                                    ))}
                                </div>
                                <span className="ml-auto text-sm font-extrabold text-[#3F3127]">Nền</span>
                                <div className="flex shrink-0 items-center gap-2.5">
                                    {BACKGROUNDS.map((b) => (
                                        <button
                                            key={b.id}
                                            onClick={() => setChonNen(b.id)}
                                            disabled={khoa}
                                            title={b.ten}
                                            aria-label={`Nền ${b.ten}`}
                                            className={`flex h-11 w-11 items-center justify-center rounded-full border border-black/10 shadow-sm active:scale-95 ${chonNen === b.id ? 'ring-4 ring-[#e63946] ring-offset-2' : ''}`}
                                            style={{ background: `rgb(${b.rgb.join(',')})` }}
                                        >
                                            {chonNen === b.id && <Check size={20} strokeWidth={3} className={sangNen(b.id) ? 'text-[#3F3127]' : 'text-white'} />}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white/80 p-4 shadow-sm">
                                <div className="mb-3 flex shrink-0 gap-2">
                                    {TABS_MAT.map((t) => (
                                        <button
                                            key={t.id}
                                            onClick={() => setTab(t.id)}
                                            className={`flex-1 whitespace-nowrap rounded-full px-1 py-2 text-sm font-extrabold ${tab === t.id ? 'bg-[#7B5E43] text-white' : 'bg-[#F6E6C9]'}`}
                                        >
                                            {t.label}
                                        </button>
                                    ))}
                                </div>

                                {currentTab && currentTab.scope === 'face' && (
                                    <div className="flex min-h-0 flex-1 flex-col">
                                        <div className="mb-3 grid shrink-0 grid-cols-4 gap-2">
                                            {presets.map((p) => (
                                                <button
                                                    key={p.id}
                                                    onClick={() => choosePreset(p)}
                                                    disabled={khoa}
                                                    className={`min-h-11 whitespace-nowrap rounded-2xl border-2 px-1 text-[13px] font-extrabold leading-tight active:scale-95 ${edit.presetId === p.id ? 'border-[#7B5E43] bg-[#D5B895] text-white' : 'border-[#D5B895] bg-white'}`}
                                                >
                                                    {p.name}
                                                    {edit.presetId === p.id && presetTouched && <span className="block text-[10px] font-bold opacity-90">đã chỉnh thêm</span>}
                                                </button>
                                            ))}
                                        </div>
                                        <p className="mb-3 shrink-0 text-xs font-bold text-[#7A5A3B]/80">
                                            {!engineReady ? 'Đang nạp bộ chỉnh mặt…'
                                                : matCua[src] && !matCua[src].length ? 'Không thấy khuôn mặt trong ảnh này.'
                                                    : 'Ảnh thẻ nên chỉnh nhẹ để vẫn giống người thật khi nộp hồ sơ.'}
                                        </p>
                                        <div className="grid grid-cols-2 content-start gap-x-6 gap-y-4">
                                            {currentTab.sliders.map((s) => {
                                                const v = sliderValue(edit, s, 'all');
                                                return (
                                                    <div key={`${s.group}.${s.key}`} className={!engineReady ? 'opacity-40' : ''}>
                                                        <div className="mb-1.5 flex items-center gap-2 whitespace-nowrap text-sm font-extrabold">
                                                            <span>{s.label}</span>
                                                            <span className="ml-auto tabular-nums">{Math.round(v * 100)}</span>
                                                        </div>
                                                        <input
                                                            type="range"
                                                            className="pe-range"
                                                            min={s.min}
                                                            max={s.max}
                                                            step={s.step}
                                                            value={v}
                                                            disabled={!engineReady || khoa}
                                                            onChange={(e) => setValue(s, parseFloat(e.target.value))}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {tab === 'heal' && (
                                    <div className="flex flex-col items-start gap-3">
                                        <p className="text-xs font-bold text-[#7A5A3B]/80">Chạm vào nốt mụn / vết thâm trên ảnh bên trái để xoá.</p>
                                        <p className="text-sm font-extrabold">{spots.length ? `Đã xoá ${spots.length} chỗ trên ảnh này.` : 'Chưa xoá chỗ nào.'}</p>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                disabled={!spots.length || khoa}
                                                onClick={() => update(popSpot)}
                                                className="flex items-center gap-2 rounded-full border-2 border-[#D5B895] bg-white px-4 py-2 text-sm font-extrabold active:scale-95 disabled:opacity-40"
                                            >
                                                <Undo2 size={16} /> Bỏ chỗ vừa chạm
                                            </button>
                                            <button
                                                type="button"
                                                disabled={!spots.length || khoa}
                                                onClick={() => update(clearSpots)}
                                                className="flex items-center gap-2 rounded-full border-2 border-[#D5B895] bg-white px-4 py-2 text-sm font-extrabold active:scale-95 disabled:opacity-40"
                                            >
                                                <X size={16} /> Bỏ hết
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white/80 p-4 shadow-sm">
                            <p className="mb-3 shrink-0 text-sm font-extrabold text-[#3F3127]">Chọn khung cho tờ ảnh thẻ</p>
                            <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-[repeat(2,minmax(0,1fr))] gap-3">
                                {khungTrang.map((k) => (
                                    <button
                                        key={k.id}
                                        onClick={() => setChonKhung(k.id)}
                                        disabled={khoa}
                                        className={`flex min-h-0 min-w-0 flex-col items-center rounded-2xl border-[3px] p-2 active:scale-95 ${chonKhung === k.id ? 'border-[#e63946] bg-[#fff4f2]' : 'border-transparent bg-[#FFF8E7]'}`}
                                    >
                                        <Fit ratio={2 / 3}>
                                            <KhungNho khung={k} />
                                        </Fit>
                                    </button>
                                ))}
                            </div>
                            {soTrang > 1 && (
                                <div className="mt-2 flex shrink-0 items-center justify-center gap-4">
                                    <button disabled={trang === 0} onClick={() => setTrangKhung(trang - 1)} className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#7B5E43]/30 bg-white disabled:opacity-30"><ChevronLeft size={22} /></button>
                                    <span className="text-sm font-extrabold tabular-nums">{trang + 1} / {soTrang}</span>
                                    <button disabled={trang === soTrang - 1} onClick={() => setTrangKhung(trang + 1)} className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#7B5E43]/30 bg-white disabled:opacity-30"><ChevronRight size={22} /></button>
                                </div>
                            )}
                        </div>
                    )}

                    {canhBao && (
                        <div className="flex shrink-0 items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                            <span>{canhBao}</span>
                        </div>
                    )}

                    {buoc === 1 ? (
                        <button
                            onClick={() => { setXemGoc(false); setBuoc(2); }}
                            className="flex w-full shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#7B5E43] py-4 text-xl font-black text-white shadow-lg active:scale-95"
                        >
                            Tiếp: chọn khung <ArrowRight size={24} />
                        </button>
                    ) : (
                        <div className="flex shrink-0 gap-3">
                            {!khoa && (
                                <button
                                    onClick={() => setBuoc(1)}
                                    className="flex items-center gap-2 rounded-2xl border-2 border-[#D5B895] bg-white px-5 text-base font-extrabold active:scale-95"
                                >
                                    <ArrowLeft size={20} /> Chỉnh ảnh
                                </button>
                            )}
                            <button
                                onClick={inAnh}
                                disabled={dangXuLy || dangIn}
                                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#e63946] py-4 text-xl font-black text-white shadow-lg shadow-[#e63946]/20 active:scale-95 disabled:opacity-60"
                            >
                                {dangIn ? <Loader2 className="animate-spin" size={24} /> : <Printer size={24} />}
                                {dangIn ? (daIn ? 'Đang lưu ảnh…' : 'Đang gửi lệnh in…') : (daIn ? 'Lưu lại' : 'In ảnh thẻ')}
                            </button>
                            {daIn && !dangIn && (
                                <button
                                    onClick={resetSession}
                                    className="flex items-center gap-2 rounded-2xl border-2 border-[#D5B895] bg-white px-5 text-base font-extrabold active:scale-95"
                                >
                                    Kết thúc
                                </button>
                            )}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
};

export default IdPhotoStudio;
