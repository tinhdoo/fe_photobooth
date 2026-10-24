import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Clock, Copy, Eye, Loader2, RotateCcw, Undo2, Users, X } from 'lucide-react';
import { useWorkflow } from '../../context/WorkflowContext';
import {
    SLIDER_TABS, SWATCHES, EMPTY_EDIT, editFromPreset, sliderValue, colorValue, setEditValue, resetFace,
    isNeutral, editKey, editForOtherPhoto, addSpot, popSpot, clearSpots, MAX_SPOTS,
} from '../../faceFilter/ai/photoEditState';
import { facesForMatching, matchPeople } from '../../faceFilter/ai/matchPeople';

// BƯỚC 5.5 — CHỈNH ẢNH. Nằm giữa Chọn ảnh (5) và Chỉnh sửa (6), chỉ có khi admin bật (photo_edit_enabled).
// Khách chỉnh TỪNG ảnh: chọn kiểu có sẵn làm điểm khởi đầu rồi kéo thanh trượt; chỉnh chung cả ảnh hoặc chạm
// vào một người để chỉnh riêng người đó; tab Xoá mụn thì chạm lên ảnh để đặt chấm. Xem trước ở cỡ nhỏ; ảnh gốc
// chỉ làm một lần lúc bấm Tiếp tục (hoặc hết giờ của bước).
// Mặt của mọi ảnh được dò ở nền rồi ghép người (matchPeople.js) -> "Người 2" là cùng một bạn trên mọi ảnh, và
// "Áp kiểu này cho các ảnh khác" chép phần chỉnh riêng sang đúng bạn đó.
// sessionData.photoEditState = { [url ảnh gốc]: edit (photoEditState.js) } — để quay lại không mất.
// sessionData.photoEdits = { [url ảnh gốc]: { key, url ảnh đã chỉnh } } — Edit dùng bảng này thay ảnh gốc.

const getPhotoUrl = (photo) => {
    if (!photo) return null;
    return typeof photo === 'string' ? photo : photo.url;
};

const PREVIEW_MAX = 1280;          // cạnh dài ảnh xem trước (P1: 60-200 ms bằng card đồ hoạ)
const PHOTO_TIMEOUT_MS = 30000;    // hạn tải + dò mặt một ảnh
const CHIP_PX = 96;
const SPOT_R = 0.03;               // bán kính chấm xoá mụn = 3% bề rộng mặt gần nhất
const SPOT_R_NO_FACE = 0.012;      // không thấy mặt: theo chiều cao ảnh
const NORMAL = { id: 'normal', name: 'Gốc', def: null };

const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
    const t = setTimeout(() => {
        const err = new Error(`${label} quá ${Math.round(ms / 1000)} giây`);
        err.quaGio = true;
        reject(err);
    }, ms);
    Promise.resolve(promise).then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); },
    );
});

const loadImage = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Không tải được ảnh: ${url}`));
    img.src = url;
});

const nhuong = (ms = 0) => new Promise((r) => setTimeout(r, ms)); // nhường nhịp cho màn hình / thao tác kịp chạy

// Khung bao khuôn mặt (toạ độ chuẩn hoá) từ viền mặt.
const faceBox = (f) => {
    const xs = f.rings.faceOval.map((p) => p.x), ys = f.rings.faceOval.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

// Ảnh nhỏ của từng khuôn mặt để khách chọn người.
const faceChip = (base, box) => {
    const W = base.width, H = base.height;
    const cx = ((box.x0 + box.x1) / 2) * W, cy = ((box.y0 + box.y1) / 2) * H;
    const side = Math.max((box.x1 - box.x0) * W, (box.y1 - box.y0) * H) * 1.35;
    const c = document.createElement('canvas');
    c.width = CHIP_PX;
    c.height = CHIP_PX;
    c.getContext('2d').drawImage(base, cx - side / 2, cy - side / 2, side, side, 0, 0, CHIP_PX, CHIP_PX);
    return c.toDataURL('image/jpeg', 0.8);
};

const fmt = (s, v) => {
    if (s.group === 'color') {
        const d = s.def === 1 ? (v - 1) * 100 : v * 100;
        return `${d > 0 ? '+' : ''}${Math.round(d)}`;
    }
    return `${Math.round(v * 100)}`;
};

const RANGE_CSS = `
.pe-range{-webkit-appearance:none;appearance:none;width:100%;height:10px;border-radius:999px;background:#ead8bd;outline:none;touch-action:none}
.pe-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:30px;height:30px;border-radius:50%;background:#7B5E43;border:4px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25)}
`;

const PhotoEdit = () => {
    const { nextStep, prevStep, sessionData, updateSessionData, timedOut, configs } = useWorkflow();
    const primaryTextColor = configs?.brand_text_primary || '#7B5E43';
    const secondaryTextColor = configs?.brand_text_secondary || '#5E6B78';
    const limit = Math.max(30, parseInt(configs?.photo_edit_timeout, 10) || 200);

    // Các ô theo thứ tự in; một ảnh có thể nằm ở nhiều ô -> chỉnh theo ảnh (url), không theo ô.
    const slotUrls = useMemo(() => (sessionData.photos || []).map(getPhotoUrl), [sessionData.photos]);
    const urls = useMemo(() => [...new Set(slotUrls.filter(Boolean))], [slotUrls]);

    const [edits, setEdits] = useState(() => sessionData.photoEditState || {});
    const [activePick, setActive] = useState(null);
    const active = urls.includes(activePick) ? activePick : (urls[0] || null);
    const [target, setTarget] = useState('all');       // 'all' hoặc chỉ số mặt
    const [tab, setTab] = useState(SLIDER_TABS[0].id);
    const [showOriginal, setShowOriginal] = useState(false);
    const [presets, setPresets] = useState([NORMAL]);
    const [engineReady, setEngineReady] = useState(false);
    const [infos, setInfos] = useState({});            // url -> { faces, boxes, chips, match } (khi đã dò xong)
    const [loading, setLoading] = useState(false);
    const [previewError, setPreviewError] = useState(false);
    const [finishing, setFinishing] = useState(null);  // { done, total } khi đang làm ảnh gốc
    // Thời gian của bước tính cho cả lượt: vào lại (từ Chỉnh sửa / Chọn ảnh) chạy tiếp phần còn lại.
    const [timeLeft, setTimeLeft] = useState(() => {
        const left = sessionData.photoEditTimeLeft;
        return typeof left === 'number' && left > 0 ? Math.min(left, limit) : limit;
    });
    const [canvasSize, setCanvasSize] = useState(null); // cỡ thật của ảnh xem trước
    const [stage, setStage] = useState({ w: 0, h: 0 });  // chỗ trống để hiện ảnh
    const [toast, setToast] = useState(null);

    const edit =(active && edits[active]) || EMPTY_EDIT;
    const info = active ? infos[active] : null;
    const faceCount = info?.faces.length || 0;
    const tgt = target !== 'all' && target < faceCount ? target : 'all';

    const engineRef = useRef(null);            // module applyBeauty.js (nạp động: kéo theo MediaPipe)
    const baseRef = useRef(new Map());         // url -> Promise<{ base, faces, boxes, chips }>
    const canvasRef = useRef(null);
    const stageRef = useRef(null);
    const latestRef = useRef({});              // trạng thái mới nhất cho vòng vẽ
    const busyRef = useRef(false);
    const dirtyRef = useRef(false);
    const finishingRef = useRef(false);
    const editsRef = useRef(edits);
    editsRef.current = edits;
    const timeLeftRef = useRef(timeLeft);
    timeLeftRef.current = timeLeft;
    const failedRef = useRef(new Set());       // ảnh dò nền bị lỗi -> không thử lại liên tục
    const applyingRef = useRef(false);

    // Live view tắt ở bước này. Quay lại Chọn ảnh rồi bấm chụp lại thì phải qua màn Chuẩn bị chờ máy ấm,
    // không vào thẳng Chụp với cờ "đã ấm" cũ.
    useEffect(() => {
        updateSessionData('cameraWarm', false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        let alive = true;
        withTimeout(import('../../faceFilter/ai/applyBeauty.js'), PHOTO_TIMEOUT_MS, 'Nạp bộ làm đẹp')
            .then(async (mod) => {
                if (!alive) return;
                engineRef.current = mod;
                setEngineReady(true);
                const list = await mod.loadBeautyPresets();
                if (alive) setPresets([NORMAL, ...list.map((def) => ({ id: def.id, name: def.name, def }))]);
            })
            .catch((e) => console.error('[Chinh anh] Khong nap duoc bo lam dep:', e));
        return () => { alive = false; };
    }, []);

    // Ảnh thu nhỏ + mặt của một ảnh, làm MỘT lần rồi dùng lại cho mọi lần xem trước và cả ảnh gốc.
    const getBase = useCallback((url) => {
        const cache = baseRef.current;
        if (!cache.has(url)) {
            const job = (async () => {
                const img = await loadImage(url);
                const w = img.naturalWidth, h = img.naturalHeight;
                const s = Math.min(1, PREVIEW_MAX / Math.max(w, h));
                const base = document.createElement('canvas');
                base.width = Math.round(w * s);
                base.height = Math.round(h * s);
                base.getContext('2d').drawImage(img, 0, 0, base.width, base.height);
                const faces = await engineRef.current.detectFacesOn(base);
                const boxes = faces.map(faceBox);
                const chips = boxes.map((b) => faceChip(base, b));
                let match = [];
                try { match = facesForMatching(base, faces); } catch (e) { console.warn('[Chinh anh] Khong lay duoc dac trung mat:', e); }
                setInfos((p) => ({ ...p, [url]: { faces, boxes, chips, match } }));
                return { base, faces, match };
            })();
            cache.set(url, job);
            job.catch(() => cache.delete(url)); // lỗi thì lần sau thử lại
        }
        return withTimeout(cache.get(url), PHOTO_TIMEOUT_MS, 'Tải + dò mặt');
    }, []);

    // Vòng vẽ "mới nhất thắng": đang vẽ mà khách kéo tiếp thì chỉ đánh dấu, vẽ xong lượt này vẽ luôn trạng thái
    // mới nhất — không xếp hàng từng nấc thanh trượt.
    const pump = useCallback(async () => {
        if (busyRef.current) { dirtyRef.current = true; return; }
        busyRef.current = true;
        try {
            do {
                dirtyRef.current = false;
                const { url, edit: e, original } = latestRef.current;
                if (!url || !engineRef.current) break;
                if (!baseRef.current.has(url)) setLoading(true);
                const { base, faces } = await getBase(url);
                setLoading(false);
                const cur = latestRef.current;
                if (cur.url !== url || cur.edit !== e || cur.original !== original) { dirtyRef.current = true; continue; }
                const t0 = performance.now();
                const out = original ? base : engineRef.current.renderEdit(base, faces, e, base.width, base.height);
                const c = canvasRef.current;
                if (c) {
                    if (c.width !== out.width) c.width = out.width;
                    if (c.height !== out.height) c.height = out.height;
                    const ctx = c.getContext('2d');
                    ctx.drawImage(out, 0, 0);
                    setCanvasSize((p) => (p && p.w === out.width && p.h === out.height ? p : { w: out.width, h: out.height }));
                }
                window.__photoEditStats = { ms: Math.round(performance.now() - t0), w: base.width, h: base.height, faces: faces.length };
                setPreviewError(false);
                await nhuong(); // cho sự kiện kéo thanh trượt kịp tới
            } while (dirtyRef.current);
        } catch (err) {
            console.error('[Chinh anh] Xem truoc that bai:', err);
            setLoading(false);
            setPreviewError(true);
        } finally {
            busyRef.current = false;
        }
    }, [getBase]);

    useEffect(() => {
        latestRef.current = { url: active, edit, original: showOriginal };
        if (engineReady) pump();
    }, [active, edit, showOriginal, engineReady, pump]);

    // Ảnh đang xem đã sẵn -> dò lần lượt các ảnh còn lại ở nền để đánh số người giống nhau trên mọi ảnh.
    useEffect(() => {
        if (!engineReady || !active || !infos[active]) return undefined;
        const rest = urls.filter((u) => !infos[u] && !failedRef.current.has(u));
        if (!rest.length) return undefined;
        let alive = true;
        (async () => {
            for (const u of rest) {
                await nhuong(50);
                if (!alive || finishingRef.current) return;
                try {
                    await getBase(u);
                } catch (e) {
                    failedRef.current.add(u); // không đánh số được ảnh này, vẫn chỉnh bình thường
                    console.warn('[Chinh anh] Do mat nen that bai:', e);
                }
            }
        })();
        return () => { alive = false; };
    }, [engineReady, active, infos, urls, getBase]);

    // Số người (0, 1, …) của từng mặt trên từng ảnh — cùng số = cùng một bạn. Ảnh chưa dò xong thì tạm theo thứ tự.
    const peopleIds = useMemo(() => {
        const ids = matchPeople(urls.map((u) => ({ faces: infos[u]?.match || [] })));
        return Object.fromEntries(urls.map((u, i) => [u, ids[i]]));
    }, [urls, infos]);
    const personNo = (i) => {
        const id = peopleIds[active]?.[i];
        return (id >= 0 ? id : i) + 1;
    };

    const update = (fn) => {
        if (!active || finishingRef.current) return;
        setEdits((p) => ({ ...p, [active]: fn(p[active] || EMPTY_EDIT) }));
    };
    // Đổi kiểu giữ lại các chấm xoá mụn đã đặt (đó là sửa ảnh, không thuộc kiểu).
    const choosePreset = (p) => { update((e) => ({ ...editFromPreset(p.def), spots: e.spots || [] })); setTarget('all'); };
    const setValue = (s, v) => update((e) => setEditValue(e, s.group, s.key, v, s.group === 'color' ? 'all' : tgt));
    const setColor = (group, key, v) => update((e) => setEditValue(e, group, key, v, tgt));
    const resetPhoto = () => { update(() => editFromPreset(null)); setTarget('all'); };
    const resetPerson = () => update((e) => resetFace(e, tgt));
    // Chép chỉnh của ảnh này sang các ảnh khác. Phần chỉnh riêng từng người đi theo ĐÚNG người (ghép bằng
    // matchPeople), người không có mặt ở ảnh kia thì thôi. Chấm xoá mụn của ảnh kia giữ nguyên.
    const applyToAll = async () => {
        if (!active || finishingRef.current || applyingRef.current) return;
        applyingRef.current = true;
        try {
            const others = urls.filter((u) => u !== active);
            const own = Object.keys(editsRef.current[active]?.faces || {}).map(Number);
            let ids = null;
            if (own.length) {
                // Thường đã dò xong ở nền; chưa xong thì chờ (có báo). Ảnh dò lỗi coi như không có ai.
                if (urls.some((u) => !infos[u] && !failedRef.current.has(u))) setToast('Đang tìm từng người trong các ảnh khác…');
                const all = await Promise.all(urls.map((u) => (failedRef.current.has(u)
                    ? Promise.resolve([])
                    : getBase(u).then((r) => r.match || [], () => []))));
                if (finishingRef.current) return;
                ids = matchPeople(all.map((faces) => ({ faces })));
            }
            const ai = urls.indexOf(active);
            const found = Object.fromEntries(own.map((i) => [i, 0]));
            const maps = Object.fromEntries(others.map((u) => {
                const faceMap = {};
                own.forEach((i) => {
                    const j = ids ? ids[urls.indexOf(u)].indexOf(ids[ai][i]) : -1;
                    if (j >= 0) { faceMap[i] = j; found[i] += 1; }
                });
                return [u, faceMap];
            }));
            const src = editsRef.current[active] || EMPTY_EDIT;
            setEdits((p) => ({ ...p, ...Object.fromEntries(others.map((u) => [u, editForOtherPhoto(src, maps[u], p[u]?.spots)])) }));
            // Ảnh đang xem không đổi nên phải báo rõ, kẻo khách tưởng nút không ăn.
            const name = (i) => `Người ${(ids?.[ai][i] ?? i) + 1}`;
            const seen = own.filter((i) => found[i] > 0);
            const unseen = own.filter((i) => !found[i]);
            const parts = [];
            if (seen.length) parts.push(`chỉnh riêng ${seen.map((i) => `${name(i)} (${found[i]}/${others.length} ảnh)`).join(', ')}`);
            if (unseen.length) parts.push(`${unseen.map(name).join(', ')} không có ở ảnh khác nên chỉ chép phần chung`);
            setToast(`Đã áp cho ${others.length} ảnh khác${parts.length ? ` — ${parts.join('; ')}` : ''}`);
        } finally {
            applyingRef.current = false;
        }
    };
    useEffect(() => {
        if (!toast) return undefined;
        const t = setTimeout(() => setToast(null), Math.max(2500, toast.length * 60)); // câu dài -> đủ thời gian đọc
        return () => clearTimeout(t);
    }, [toast]);

    // Ảnh xem trước co theo chỗ trống (không thanh cuộn ở bất kỳ cỡ màn hình nào).
    useEffect(() => {
        const el = stageRef.current;
        if (!el) return undefined;
        // Đo ngay một lần: ResizeObserver chỉ báo khi trình duyệt vẽ khung hình — cửa sổ đang bị che thì không báo,
        // ảnh xem trước sẽ rộng 0.
        const r0 = el.getBoundingClientRect();
        setStage({ w: r0.width, h: r0.height });
        const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const fitScale = canvasSize && stage.w > 0 ? Math.min(stage.w / canvasSize.w, stage.h / canvasSize.h) : 0;
    const pickPhoto = (url) => { setActive(url); setTarget('all'); };

    // Chạm vào ảnh xem trước. Tab Xoá mụn: đặt chấm tại điểm chạm (cỡ theo mặt gần nhất). Tab khác: chọn người có
    // khung mặt chứa điểm chạm (người nhỏ nhất nếu chồng nhau).
    const onPreviewTap = (ev) => {
        if (showOriginal) return;
        const r = ev.currentTarget.getBoundingClientRect();
        const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
        if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return; // cả NaN (khung ảnh chưa có cỡ)
        if (tab === 'heal') {
            const aspect = canvasSize ? canvasSize.w / canvasSize.h : 1;
            let rad = SPOT_R_NO_FACE, best = Infinity;
            (info?.boxes || []).forEach((bx) => {
                const d = Math.hypot(((bx.x0 + bx.x1) / 2 - x) * aspect, (bx.y0 + bx.y1) / 2 - y);
                if (d < best) { best = d; rad = Math.max(0.003, (bx.x1 - bx.x0) * aspect * SPOT_R); }
            });
            if ((edit.spots || []).length >= MAX_SPOTS) { setToast(`Tối đa ${MAX_SPOTS} chỗ mỗi ảnh`); return; }
            update((e) => addSpot(e, { x, y, r: rad }));
            return;
        }
        if (!info?.boxes.length) return;
        let best = -1, area = Infinity;
        info.boxes.forEach((bx, i) => {
            const ar = (bx.x1 - bx.x0) * (bx.y1 - bx.y0);
            if (x >= bx.x0 && x <= bx.x1 && y >= bx.y0 && y <= bx.y1 && ar < area) { best = i; area = ar; }
        });
        if (best >= 0) {
            setTarget(best);
            if (SLIDER_TABS.find((t) => t.id === tab)?.scope !== 'face') setTab('beauty');
        }
    };

    // Làm ảnh gốc cho các ảnh có chỉnh rồi sang bước Chỉnh sửa. Ảnh nào lỗi / quá giờ thì giữ ảnh gốc — khách
    // đã trả tiền, không được kẹt ở đây.
    const finish = useCallback(async () => {
        if (finishingRef.current) return;
        finishingRef.current = true;
        const all = editsRef.current;
        const old = sessionData.photoEdits || {};
        const next = {};
        const can = urls.filter((u) => !isNeutral(all[u]));
        setFinishing({ done: 0, total: can.length });
        await nhuong(30);
        let treo = !engineRef.current;
        for (let i = 0; i < can.length; i += 1) {
            const url = can[i];
            const key = editKey(all[url]);
            if (old[url]?.url && old[url].key === key) {
                next[url] = old[url]; // đã làm ở lần trước (khách quay lại rồi đi tiếp)
            } else if (!treo) {
                try {
                    // Dò mặt lỗi vẫn làm phần không cần mặt (màu ảnh, chấm xoá mụn); chỉ quá giờ mới coi là kẹt.
                    let faces = [];
                    try {
                        ({ faces } = await getBase(url));
                    } catch (e) {
                        if (e?.quaGio) throw e;
                        console.warn('[Chinh anh] Khong do duoc mat, chi lam mau + xoa mun:', e);
                    }
                    const img = await withTimeout(loadImage(url), PHOTO_TIMEOUT_MS, 'Tải ảnh gốc');
                    const out = engineRef.current.renderEdit(img, faces, all[url], img.naturalWidth, img.naturalHeight);
                    const outUrl = await withTimeout(engineRef.current.canvasToObjectUrl(out), PHOTO_TIMEOUT_MS, 'Nén ảnh');
                    if (outUrl) next[url] = { key, url: outUrl };
                } catch (e) {
                    if (e?.quaGio) treo = true; // một ảnh quá giờ = đang kẹt -> các ảnh sau giữ ảnh gốc
                    console.error('[Chinh anh] Lam anh goc that bai, giu anh goc:', e);
                }
            }
            setFinishing({ done: i + 1, total: can.length });
            await nhuong(30);
        }
        // Ảnh đã chỉnh lần trước mà giờ bỏ / đổi -> giải phóng.
        Object.values(old).forEach((e) => {
            if (e?.url && !Object.values(next).some((n) => n.url === e.url)) {
                try { URL.revokeObjectURL(e.url); } catch { /* bỏ qua */ }
            }
        });
        updateSessionData('photoEditState', all);
        updateSessionData('photoEdits', next);
        updateSessionData('photoEditTimeLeft', timeLeftRef.current);
        nextStep();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [urls, getBase, sessionData.photoEdits]);

    // Đồng hồ riêng của bước (đồng hồ phiên đứng yên trong lúc này). Hết giờ -> tự đi tiếp.
    useEffect(() => {
        if (finishing) return undefined;
        const t = setInterval(() => setTimeLeft((s) => Math.max(0, s - 1)), 1000);
        return () => clearInterval(t);
    }, [finishing]);
    useEffect(() => {
        if (timeLeft === 0 || timedOut) finish();
    }, [timeLeft, timedOut, finish]);

    const handleBack = () => {
        if (finishingRef.current) return;
        updateSessionData('photoEditState', editsRef.current);
        updateSessionData('photoEditTimeLeft', timeLeftRef.current);
        prevStep();
    };

    const currentTab = SLIDER_TABS.find((t) => t.id === tab) || SLIDER_TABS[0];
    const presetBase = presets.find((p) => p.id === edit.presetId);
    // So với kiểu gốc, không tính chấm xoá mụn (đổi kiểu vẫn giữ chấm).
    const presetTouched = presetBase && editKey({ ...edit, spots: [] }) !== editKey(editFromPreset(presetBase.def));
    const personHasOwn = tgt !== 'all' && !!edit.faces?.[tgt];
    const showBoxes = !showOriginal && currentTab.scope === 'face' && faceCount > 0;
    const spots = edit.spots || [];
    const showSpots = !showOriginal && currentTab.scope === 'heal' && canvasSize;

    const mm = Math.floor(timeLeft / 60);
    const ss = timeLeft % 60;
    const critical = timeLeft < 30;

    return (
        <div
            className="relative flex h-screen w-full flex-col overflow-hidden bg-[#FFF8E7] bg-cover bg-center px-6 py-4 font-serif"
            style={{ backgroundImage: configs?.['bg_filter-adjustment'] ? `url('${configs['bg_filter-adjustment']}')` : 'none', color: secondaryTextColor }}
        >
            <style>{RANGE_CSS}</style>
            <header className="flex shrink-0 items-center justify-center pb-3">
                <h2 className="text-3xl font-extrabold uppercase tracking-[0.1em]" style={{ color: primaryTextColor }}>Chỉnh ảnh</h2>
            </header>

            <div
                className={`fixed right-6 top-4 z-40 flex items-center gap-2 rounded-full border-2 px-4 py-1.5 font-bold shadow-lg backdrop-blur-sm ${
                    critical ? 'animate-pulse border-red-200 bg-red-50 text-red-600' : 'border-[#A8B5A0]/30 bg-white/90 text-[#52796f]'
                }`}
            >
                <Clock size={18} />
                <span className="text-lg tabular-nums">{String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}</span>
            </div>

            <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.2fr)_minmax(440px,1fr)] gap-5">
                {/* TRÁI: ảnh xem trước + chọn ảnh / chọn người */}
                <section className="flex min-h-0 flex-col gap-3">
                    <div className="relative min-h-0 flex-1 rounded-[1.5rem] bg-white/75 p-3 shadow-[0_18px_55px_-35px_rgba(47,62,70,0.45)]">
                        <div ref={stageRef} className="flex h-full w-full items-center justify-center">
                            <div
                                className="relative"
                                style={fitScale ? { width: canvasSize.w * fitScale, height: canvasSize.h * fitScale } : { width: 0, height: 0 }}
                                onPointerUp={onPreviewTap}
                            >
                                <canvas ref={canvasRef} className="block h-full w-full rounded-xl shadow-md" />
                                {showBoxes && info.boxes.map((b, i) => (
                                    <div
                                        key={i}
                                        className={`pointer-events-none absolute rounded-[40%] border-[3px] ${
                                            tgt === i ? 'border-[#e63946] shadow-[0_0_0_3px_rgba(255,255,255,0.8)]' : tgt === 'all' ? 'border-white/70' : 'border-dashed border-white/60'
                                        }`}
                                        style={{ left: `${b.x0 * 100}%`, top: `${b.y0 * 100}%`, width: `${(b.x1 - b.x0) * 100}%`, height: `${(b.y1 - b.y0) * 100}%` }}
                                    />
                                ))}
                                {showSpots && spots.map((sp, i) => (
                                    <div
                                        key={i}
                                        className="pointer-events-none absolute rounded-full border-2 border-dashed border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                                        style={{
                                            left: `${sp.x * 100}%`,
                                            top: `${sp.y * 100}%`,
                                            width: `${(2 * sp.r * canvasSize.h * 100) / canvasSize.w}%`,
                                            height: `${2 * sp.r * 100}%`,
                                            transform: 'translate(-50%, -50%)',
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                        {(loading || !engineReady) && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Loader2 size={48} className="animate-spin text-[#7B5E43]/70" />
                            </div>
                        )}
                        {previewError && !loading && (
                            <p className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-5 py-2 text-sm font-bold text-[#7A5A3B] shadow">
                                Không xem trước được ảnh này — ảnh vẫn được in bình thường.
                            </p>
                        )}
                        <button
                            type="button"
                            onPointerDown={() => setShowOriginal(true)}
                            onPointerUp={() => setShowOriginal(false)}
                            onPointerLeave={() => setShowOriginal(false)}
                            onPointerCancel={() => setShowOriginal(false)}
                            onContextMenu={(e) => e.preventDefault()}
                            className="absolute bottom-4 right-4 flex select-none items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-extrabold text-[#7A5A3B] shadow-md active:bg-[#D5B895] active:text-white"
                            style={{ touchAction: 'none' }}
                        >
                            <Eye size={18} /> Giữ để xem ảnh gốc
                        </button>
                    </div>

                    <div className="flex shrink-0 items-center gap-4 rounded-2xl bg-white/75 px-4 py-2 shadow-sm">
                        {urls.length > 1 && (
                            <div className="flex shrink-0 items-center gap-2">
                                <span className="text-sm font-extrabold" style={{ color: primaryTextColor }}>Ảnh</span>
                                {urls.map((url, i) => (
                                    <button
                                        type="button"
                                        key={url}
                                        onClick={() => pickPhoto(url)}
                                        className={`relative h-12 w-16 shrink-0 overflow-hidden rounded-lg border-[3px] bg-white transition-none active:scale-95 ${
                                            url === active ? 'border-[#7B5E43]' : 'border-transparent'
                                        }`}
                                    >
                                        <img src={url} className="h-full w-full object-cover" alt={`Ảnh ${i + 1}`} />
                                        {!isNeutral(edits[url]) && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#e63946]" />}
                                    </button>
                                ))}
                            </div>
                        )}
                        {urls.length > 1 && <div className="h-10 w-px shrink-0 bg-[#D5B895]/60" />}
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                            <span className="flex shrink-0 items-center gap-1 text-sm font-extrabold" style={{ color: primaryTextColor }}><Users size={16} /> Người</span>
                            {faceCount > 0 ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => setTarget('all')}
                                        className={`h-11 shrink-0 rounded-full border-2 px-3 text-sm font-extrabold transition-none active:scale-95 ${
                                            tgt === 'all' ? 'border-[#7B5E43] bg-[#D5B895] text-white' : 'border-[#D5B895] bg-white text-[#7A5A3B]'
                                        }`}
                                    >
                                        Tất cả ({faceCount})
                                    </button>
                                    {info.chips.map((src, i) => (
                                        <button
                                            type="button"
                                            key={i}
                                            onClick={() => { setTarget(i); if (currentTab.scope !== 'face') setTab('beauty'); }}
                                            className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-full border-[3px] transition-none active:scale-95 ${
                                                tgt === i ? 'border-[#e63946]' : 'border-white'
                                            }`}
                                        >
                                            <img src={src} className="h-full w-full object-cover" alt={`Người ${personNo(i)}`} />
                                            <span className="absolute bottom-0 left-0 rounded-tr-md bg-black/55 px-1 text-[10px] font-extrabold leading-tight text-white">{personNo(i)}</span>
                                            {edit.faces?.[i] && <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#7B5E43]" />}
                                        </button>
                                    ))}
                                </>
                            ) : (
                                <span className="text-xs font-semibold">
                                    {info ? 'Không thấy khuôn mặt — vẫn chỉnh được Màu ảnh.' : 'Đang tìm khuôn mặt…'}
                                </span>
                            )}
                        </div>
                    </div>
                </section>

                {/* PHẢI: kiểu có sẵn + thanh trượt (vừa một màn, không cuộn) */}
                <section className="flex min-h-0 flex-col gap-3">
                    <div className="grid shrink-0 grid-cols-4 gap-2">
                        {presets.map((p) => (
                            <button
                                type="button"
                                key={p.id}
                                onClick={() => choosePreset(p)}
                                className={`min-h-11 whitespace-nowrap rounded-2xl border-2 px-1 text-[13px] font-extrabold leading-tight transition-none active:scale-95 ${
                                    edit.presetId === p.id
                                        ? 'border-[#7B5E43] bg-[#D5B895] text-white shadow-md'
                                        : 'border-[#D5B895] bg-white text-[#7A5A3B]'
                                }`}
                            >
                                {p.name}
                                {edit.presetId === p.id && presetTouched && <span className="block text-[10px] font-bold opacity-90">đã chỉnh thêm</span>}
                            </button>
                        ))}
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-white/80 p-4 shadow-sm">
                        <div className="mb-2 flex shrink-0 gap-2">
                            {SLIDER_TABS.map((t) => (
                                <button
                                    type="button"
                                    key={t.id}
                                    onClick={() => setTab(t.id)}
                                    className={`flex-1 whitespace-nowrap rounded-full px-1 py-2 text-sm font-extrabold transition-none ${
                                        tab === t.id ? 'bg-[#7B5E43] text-white' : 'bg-[#F6E6C9] text-[#7A5A3B]'
                                    }`}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                        <p className="mb-3 shrink-0 text-xs font-bold text-[#7A5A3B]/80">
                            {currentTab.scope === 'color'
                                ? 'Màu áp cho cả ảnh.'
                                : currentTab.scope === 'heal' ? 'Chạm vào nốt mụn / vết thâm trên ảnh để xoá.'
                                    : faceCount === 0 ? 'Không thấy khuôn mặt trong ảnh này.'
                                        : tgt === 'all' ? `Đang chỉnh cho tất cả ${faceCount} người — chạm vào một người trên ảnh để chỉnh riêng.` : `Đang chỉnh riêng Người ${personNo(tgt)}.`}
                        </p>
                        {currentTab.scope === 'heal' && (
                            <div className="flex flex-col items-start gap-3">
                                <p className="text-sm font-extrabold text-[#7A5A3B]">
                                    {spots.length ? `Đã xoá ${spots.length} chỗ trên ảnh này.` : 'Chưa xoá chỗ nào.'}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        disabled={!spots.length}
                                        onClick={() => update(popSpot)}
                                        className="flex items-center gap-2 rounded-full border-2 border-[#D5B895] bg-white px-4 py-2 text-sm font-extrabold text-[#7A5A3B] active:scale-95 disabled:opacity-40"
                                    >
                                        <Undo2 size={16} /> Bỏ chỗ vừa chạm
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!spots.length}
                                        onClick={() => update(clearSpots)}
                                        className="flex items-center gap-2 rounded-full border-2 border-[#D5B895] bg-white px-4 py-2 text-sm font-extrabold text-[#7A5A3B] active:scale-95 disabled:opacity-40"
                                    >
                                        <X size={16} /> Bỏ hết
                                    </button>
                                </div>
                            </div>
                        )}
                        <div className="grid grid-cols-2 content-start gap-x-6 gap-y-4">
                            {currentTab.sliders.map((s) => {
                                const v = sliderValue(edit, s, tgt);
                                const disabled = currentTab.scope === 'face' && faceCount === 0;
                                return (
                                    <div key={`${s.group}.${s.key}`} className={disabled ? 'opacity-40' : ''}>
                                        <div className="mb-1.5 flex items-center gap-2 whitespace-nowrap text-sm font-extrabold text-[#7A5A3B]">
                                            <span>{s.label}</span>
                                            <span className="ml-auto tabular-nums">{fmt(s, v)}</span>
                                        </div>
                                        <input
                                            type="range"
                                            className="pe-range"
                                            min={s.min}
                                            max={s.max}
                                            step={s.step}
                                            value={v}
                                            disabled={disabled}
                                            onChange={(e) => setValue(s, parseFloat(e.target.value))}
                                        />
                                        {s.colorKey && !disabled && (
                                            <div className="mt-2 flex gap-1.5">
                                                {SWATCHES[s.colorKey].map((rgb) => {
                                                    const on = colorValue(edit, s.group, s.colorKey, tgt) === rgb;
                                                    return (
                                                        <button
                                                            type="button"
                                                            key={rgb}
                                                            onClick={() => setColor(s.group, s.colorKey, rgb)}
                                                            className={`h-7 w-7 rounded-full border-[3px] transition-none active:scale-90 ${on ? 'border-[#7B5E43]' : 'border-white shadow-sm'}`}
                                                            style={{ background: `rgb(${rgb})` }}
                                                            aria-label={`Màu ${rgb}`}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                        {personHasOwn && (
                            <button type="button" onClick={resetPerson} className="flex items-center gap-2 rounded-full border-2 border-[#D5B895] bg-white px-4 py-2 text-sm font-extrabold text-[#7A5A3B] active:scale-95">
                                <RotateCcw size={16} /> Người {personNo(tgt)} theo Tất cả
                            </button>
                        )}
                        <button type="button" onClick={resetPhoto} className="flex items-center gap-2 rounded-full border-2 border-[#D5B895] bg-white px-4 py-2 text-sm font-extrabold text-[#7A5A3B] active:scale-95">
                            <RotateCcw size={16} /> Về ảnh gốc
                        </button>
                        {urls.length > 1 && (
                            <button type="button" onClick={applyToAll} className="flex items-center gap-2 rounded-full border-2 border-[#D5B895] bg-white px-4 py-2 text-sm font-extrabold text-[#7A5A3B] active:scale-95">
                                <Copy size={16} /> Áp kiểu này cho các ảnh khác
                            </button>
                        )}
                    </div>
                </section>
            </main>

            <footer className="flex shrink-0 items-center justify-between pt-4">
                <button
                    type="button"
                    onClick={handleBack}
                    className="flex min-h-14 items-center gap-3 rounded-full border-2 border-[#D5B895] bg-white px-8 text-lg font-extrabold uppercase tracking-wide text-[#7A5A3B] shadow-sm transition-none active:scale-95"
                >
                    <ArrowLeft size={20} /> Chọn lại ảnh
                </button>
                <button
                    type="button"
                    onClick={finish}
                    className="flex min-h-14 items-center gap-3 rounded-full bg-[#D5B895] px-10 text-lg font-extrabold uppercase tracking-wide text-white shadow-lg transition-none active:scale-95"
                >
                    Tiếp tục <ArrowRight size={20} />
                </button>
            </footer>

            {toast && (
                <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 max-w-[80vw] -translate-x-1/2 rounded-3xl bg-[#4A5D4E] px-6 py-3 text-center text-base font-extrabold text-white shadow-xl">
                    {toast}
                </div>
            )}

            {finishing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="rounded-3xl border-4 border-[#D8E0D5] bg-white px-12 py-10 text-center shadow-2xl">
                        <Loader2 size={48} className="mx-auto mb-4 animate-spin text-[#7B5E43]" />
                        <p className="text-xl font-extrabold text-[#4A5D4E]">Đang hoàn thiện ảnh…</p>
                        {finishing.total > 0 && (
                            <p className="mt-2 text-lg font-bold tabular-nums text-[#7A5A3B]">{finishing.done}/{finishing.total}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PhotoEdit;
