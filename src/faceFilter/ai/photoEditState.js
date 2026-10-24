// photoEditState.js — trạng thái chỉnh MỘT ảnh ở bước Chỉnh ảnh (5.5). Thuần dữ liệu, không đụng MediaPipe.
//
// edit = {
//   presetId: 'normal' | id preset trong ai-filters.json,   // kiểu khởi đầu khách đã chọn
//   all:   { beauty, makeup },                               // áp cho MỌI khuôn mặt
//   faces: { [chỉ số mặt]: { beauty?, makeup? } },           // khách chỉnh riêng một người (ghi đè `all`)
//   color: { saturation, contrast, ... },                     // màu toàn ảnh
//   spots: [{ x, y, r }],                                     // chấm xoá mụn (chuẩn hoá; r theo chiều cao ảnh)
// }
// Chỉ số mặt theo thứ tự detectFacesOn trả về cho ảnh đó (ổn định với cùng một ảnh).

/** Thanh trượt theo nhóm. scope 'face' = theo người (beauty/makeup), 'color' = toàn ảnh. */
export const SLIDER_TABS = [
    {
        id: 'beauty', label: 'Làm đẹp', scope: 'face', sliders: [
            { group: 'beauty', key: 'retouch', label: 'Mịn da', min: 0, max: 1, step: 0.01, def: 0 },
            { group: 'beauty', key: 'brightness', label: 'Sáng da', min: 0, max: 1, step: 0.01, def: 0 },
            { group: 'beauty', key: 'toneRed', label: 'Đều màu da', min: 0, max: 1, step: 0.01, def: 0 },
            { group: 'beauty', key: 'toneYellow', label: 'Bớt vàng da', min: 0, max: 1, step: 0.01, def: 0 },
            { group: 'beauty', key: 'glow', label: 'Bóng da', min: 0, max: 1, step: 0.01, def: 0 },
            { group: 'beauty', key: 'darkCircles', label: 'Che quầng thâm', min: 0, max: 1, step: 0.01, def: 0 },
            { group: 'beauty', key: 'teeth', label: 'Trắng răng', min: 0, max: 1, step: 0.01, def: 0 },
        ],
    },
    {
        id: 'shape', label: 'Gương mặt', scope: 'face', sliders: [
            { group: 'beauty', key: 'slimFace', label: 'Gọn mặt', min: 0, max: 1, step: 0.01, def: 0 },
            { group: 'beauty', key: 'bigEyes', label: 'To mắt', min: 0, max: 1, step: 0.01, def: 0 },
            { group: 'beauty', key: 'slimNose', label: 'Thon mũi', min: 0, max: 1, step: 0.01, def: 0 },
        ],
    },
    {
        id: 'makeup', label: 'Trang điểm', scope: 'face', sliders: [
            { group: 'makeup', key: 'eye', label: 'Mắt sáng', min: 0, max: 1, step: 0.01, def: 0 },
            { group: 'makeup', key: 'blush', label: 'Má hồng', min: 0, max: 1, step: 0.01, def: 0, colorKey: 'blushColor' },
            { group: 'makeup', key: 'lips', label: 'Tươi môi', min: 0, max: 1, step: 0.01, def: 0 },
            { group: 'makeup', key: 'lipstick', label: 'Son', min: 0, max: 1, step: 0.01, def: 0, colorKey: 'lipColor' },
            { group: 'makeup', key: 'brows', label: 'Đậm mày', min: 0, max: 1, step: 0.01, def: 0 },
        ],
    },
    {
        id: 'color', label: 'Màu ảnh', scope: 'color', sliders: [
            { group: 'color', key: 'brightness', label: 'Độ sáng', min: 0.85, max: 1.15, step: 0.005, def: 1 },
            { group: 'color', key: 'contrast', label: 'Tương phản', min: 0.85, max: 1.2, step: 0.005, def: 1 },
            { group: 'color', key: 'saturation', label: 'Độ rực màu', min: 0.6, max: 1.4, step: 0.01, def: 1 },
            { group: 'color', key: 'warmth', label: 'Ấm / lạnh', min: -0.6, max: 0.6, step: 0.01, def: 0 },
            { group: 'color', key: 'pinkTint', label: 'Ánh hồng', min: 0, max: 0.4, step: 0.01, def: 0 },
            { group: 'color', key: 'highlight', label: 'Sáng vùng sáng', min: 0, max: 0.4, step: 0.01, def: 0 },
        ],
    },
    // Chạm lên ảnh để đặt chấm xoá mụn (không có thanh trượt).
    { id: 'heal', label: 'Xoá mụn', scope: 'heal', sliders: [] },
];

/** Bảng màu cho má hồng / son (chuỗi 'r,g,b' đúng định dạng lookStage nhận). */
export const SWATCHES = {
    blushColor: ['255,160,140', '255,140,168', '255,120,120', '240,150,190'],
    lipColor: ['217,120,130', '200,60,80', '230,90,110', '190,80,70', '220,110,150'],
};
const DEFAULT_COLOR = { blushColor: '255,160,140', lipColor: '217,120,130' };

const clone = (o) => JSON.parse(JSON.stringify(o || {}));

export const EMPTY_EDIT = Object.freeze({ presetId: 'normal', all: { beauty: {}, makeup: {} }, faces: {}, color: {}, spots: [] });

/** Trạng thái khởi đầu từ một preset (def = mục trong ai-filters.json; null = Gốc). */
export function editFromPreset(def) {
    if (!def) return clone(EMPTY_EDIT);
    return {
        presetId: def.id,
        all: { beauty: clone(def.beauty), makeup: clone(def.makeup) },
        faces: {},
        color: clone(def.color),
        spots: [],
    };
}

/** Bộ làm đẹp của mặt thứ i = chung (`all`) ghi đè bởi phần chỉnh riêng của mặt đó. */
export function faceLook(edit, i) {
    const own = edit?.faces?.[i] || {};
    return {
        beauty: { ...(edit?.all?.beauty || {}), ...(own.beauty || {}) },
        makeup: { ...(edit?.all?.makeup || {}), ...(own.makeup || {}) },
    };
}

/** Giá trị hiện tại của một thanh trượt cho đích đang chọn (target = 'all' hoặc chỉ số mặt). */
export function sliderValue(edit, slider, target) {
    if (slider.group === 'color') return edit?.color?.[slider.key] ?? slider.def;
    const look = target === 'all' ? { beauty: edit?.all?.beauty || {}, makeup: edit?.all?.makeup || {} } : faceLook(edit, target);
    return look[slider.group]?.[slider.key] ?? slider.def;
}

export function colorValue(edit, group, colorKey, target) {
    const look = target === 'all' ? { [group]: edit?.all?.[group] || {} } : faceLook(edit, target);
    return look[group]?.[colorKey] || DEFAULT_COLOR[colorKey];
}

/**
 * Đặt một giá trị. Chỉnh cho 'all' thì xoá giá trị riêng cùng khoá của từng người (để "Tất cả" đúng là tất cả);
 * chỉnh cho một người thì chỉ ghi vào phần riêng của người đó.
 */
export function setEditValue(edit, group, key, value, target) {
    const next = clone(edit || EMPTY_EDIT);
    if (group === 'color') {
        next.color = { ...next.color, [key]: value };
        return next;
    }
    if (target === 'all') {
        next.all[group] = { ...(next.all[group] || {}), [key]: value };
        Object.values(next.faces).forEach((f) => { if (f[group]) delete f[group][key]; });
    } else {
        const f = next.faces[target] || {};
        f[group] = { ...(f[group] || {}), [key]: value };
        next.faces[target] = f;
    }
    return next;
}

/** Bỏ phần chỉnh riêng của một người (về theo "Tất cả"). */
export function resetFace(edit, i) {
    const next = clone(edit || EMPTY_EDIT);
    delete next.faces[i];
    return next;
}

/** Ảnh có chỉnh gì không (để khỏi làm lại ảnh gốc khi khách để nguyên). */
export function isNeutral(edit) {
    if (!edit) return true;
    // Làm đẹp: mọi số = 0 là không chỉnh. Màu: brightness/contrast/saturation trung tính = 1, còn lại = 0.
    const zero = (o) => Object.values(o || {}).every((v) => typeof v !== 'number' || v === 0);
    const zeroLook = (l) => zero(l?.beauty) && zero(l?.makeup);
    const zeroColor = Object.entries(edit.color || {}).every(([k, v]) => typeof v !== 'number'
        || v === (k === 'saturation' || k === 'contrast' || k === 'brightness' ? 1 : 0));
    return zeroLook(edit.all) && Object.values(edit.faces || {}).every(zeroLook) && zeroColor && !(edit.spots || []).length;
}

/** Khoá ổn định cho cache ảnh gốc đã làm. */
export function editKey(edit) {
    const sort = (v) => (v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]))
        : v);
    return JSON.stringify(sort({ all: edit?.all, faces: edit?.faces, color: edit?.color, spots: edit?.spots || [] }));
}

/**
 * Đem chỉnh của ảnh này sang ảnh khác: phần chung + màu, và phần chỉnh riêng của từng người theo bảng ghép
 * faceMap = { [chỉ số mặt ở ảnh này]: chỉ số mặt của CÙNG người ở ảnh kia } (matchPeople). Người không ghép
 * được thì ở ảnh kia theo phần chung. Chấm xoá mụn gắn với vị trí trên ảnh này nên không chép; giữ nguyên
 * chấm đã đặt ở ảnh kia (`keepSpots`).
 */
export function editForOtherPhoto(edit, faceMap = {}, keepSpots = []) {
    const src = clone(edit || EMPTY_EDIT);
    const faces = {};
    Object.entries(src.faces || {}).forEach(([i, own]) => {
        const j = faceMap[i];
        if (j !== undefined && j !== null && j >= 0) faces[j] = own;
    });
    return { ...src, faces, spots: clone(keepSpots) };
}

/** Số chấm xoá mụn tối đa mỗi ảnh (mỗi chấm thêm một lượt vá; chạm liên tục không được làm chậm máy). */
export const MAX_SPOTS = 40;

/** Thêm / bỏ chấm xoá mụn. Chấm hỏng (NaN, ngoài ảnh) hoặc đã đủ MAX_SPOTS thì trả nguyên `edit`. */
export function addSpot(edit, spot) {
    const ok = spot && [spot.x, spot.y, spot.r].every(Number.isFinite)
        && spot.x >= 0 && spot.x <= 1 && spot.y >= 0 && spot.y <= 1 && spot.r > 0;
    if (!ok || (edit?.spots || []).length >= MAX_SPOTS) return edit || EMPTY_EDIT;
    const next = clone(edit || EMPTY_EDIT);
    next.spots = [...(next.spots || []), { x: spot.x, y: spot.y, r: Math.min(spot.r, 0.1) }];
    return next;
}
export function popSpot(edit) {
    const next = clone(edit || EMPTY_EDIT);
    next.spots = (next.spots || []).slice(0, -1);
    return next;
}
export function clearSpots(edit) {
    const next = clone(edit || EMPTY_EDIT);
    next.spots = [];
    return next;
}
