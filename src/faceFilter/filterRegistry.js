// filterRegistry.js
// Nạp danh mục filter từ /public lúc CHẠY (không bundle), nên thêm filter mới chỉ cần:
//   1) thả file ảnh vào   public/face-filters/assets/
//   2) thêm 1 mục vào      public/face-filters/filters.json
// Không cần sửa code, không cần build lại.

const BASE = '/face-filters';
const MANIFEST_URL = `${BASE}/filters.json`;

// Giá trị mặc định cho mỗi anchor để filter tối giản (chỉ có image + anchor) vẫn đẹp.
const ANCHOR_DEFAULTS = {
    head_top: { scale: 1.25, basis: 'faceWidth', offset: { x: 0, y: -0.1 }, rotate: true },
    forehead: { scale: 1.1, basis: 'faceWidth', offset: { x: 0, y: 0 }, rotate: true },
    nose: { scale: 0.32, basis: 'faceWidth', offset: { x: 0, y: 0 }, rotate: true },
    mouth: { scale: 0.5, basis: 'faceWidth', offset: { x: 0, y: 0.04 }, rotate: true },
    eyes_center: { scale: 1.05, basis: 'faceWidth', offset: { x: 0, y: 0 }, rotate: true },
    left_eye: { scale: 0.4, basis: 'interocular', offset: { x: 0, y: 0 }, rotate: true },
    right_eye: { scale: 0.4, basis: 'interocular', offset: { x: 0, y: 0 }, rotate: true },
    chin: { scale: 0.5, basis: 'faceWidth', offset: { x: 0, y: 0.1 }, rotate: true },
    face_center: { scale: 1.1, basis: 'faceWidth', offset: { x: 0, y: 0 }, rotate: true },
};

const assetUrl = (file) =>
    /^https?:\/\//i.test(file) ? file : `${BASE}/assets/${file}`;

// Gộp cấu hình asset với mặc định theo anchor.
function normalizeAsset(asset) {
    const anchor = asset.anchor || 'face_center';
    const def = ANCHOR_DEFAULTS[anchor] || ANCHOR_DEFAULTS.face_center;
    return {
        image: assetUrl(asset.image),
        anchor,
        scale: asset.scale ?? def.scale,
        basis: asset.basis ?? def.basis,
        offset: { ...def.offset, ...(asset.offset || {}) },
        rotate: asset.rotate ?? def.rotate,
        anchorY: asset.anchorY ?? 'center',
        flipX: asset.flipX ?? false,
        opacity: asset.opacity ?? 1,
    };
}

function normalizeFilter(filter) {
    return {
        id: filter.id,
        name: filter.name || filter.id,
        thumbnail: filter.thumbnail ? assetUrl(filter.thumbnail) : null,
        assets: Array.isArray(filter.assets) ? filter.assets.map(normalizeAsset) : [],
    };
}

let cache = null;

/** Trả về mảng filter đã chuẩn hoá. Có cache trong phiên. */
export async function loadFilters({ force = false } = {}) {
    if (cache && !force) return cache;
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Không tải được filters.json');
    const data = await res.json();
    const list = Array.isArray(data.filters) ? data.filters : [];
    cache = list.filter((f) => f && f.id).map(normalizeFilter);
    return cache;
}

export function clearFilterCache() {
    cache = null;
}
