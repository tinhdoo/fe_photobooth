// personSegmenter.js
// Bọc MediaPipe ImageSegmenter: tách người khỏi nền, trả về mask alpha ở ĐÚNG kích thước ảnh gốc.
// Viết theo đúng khuôn faceLandmarkerClient.js (singleton promise + tự dò file self-host).
//
// VÌ SAO CHỌN selfie_segmenter (244 KB) mà không phải thư viện khác — đo/tra ngày 2026-09-06:
//   @imgly/background-removal : giấy phép AGPL + phải tự host 211 MB dữ liệu -> loại vì pháp lý.
//   RMBG-1.4 / RMBG-2.0       : CC BY-NC, CẤM dùng thương mại -> tiệm thu tiền là vi phạm.
//   BiRefNet                  : MIT nhưng bản nhỏ nhất vẫn 109 MB + onnxruntime 135 MB -> quá nặng.
//   selfie_segmenter          : Apache-2.0, 244 KB, nằm sẵn trong @mediapipe/tasks-vision đã cài,
//                               dùng chung 9,5 MB wasm với FaceLandmarker -> thêm 0 dependency.

import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

// Cạnh dài tối đa đưa vào segment(). KHÔNG phải để cho nhanh suy luận — mạng LUÔN chạy ở 256x256
// bất kể ảnh vào, nên đưa ảnh 24MP vào cũng không nét hơn. Cái đắt là ĐỌC MASK VỀ CPU:
// đo được 291 ms ở ảnh 6000x4000 so với dưới 35 ms ở ~1024 px. Mask trả về vẫn đúng cỡ ảnh đưa vào,
// nên ta hạ cỡ ở đây rồi tự phóng mask lên kích thước gốc bằng canvas.
const SEG_MAX_EDGE = 1024;

const DEFAULT_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const DEFAULT_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

const SELF_HOST_WASM = '/face-filters/mediapipe/wasm';
const SELF_HOST_MODEL = '/face-filters/mediapipe/selfie_segmenter.tflite';

let segmenterPromise = null;
let activeDelegate = null; // 'GPU' | 'CPU' — để bên ngoài biết mà hạ độ phân giải nếu rơi về CPU

/**
 * Kiểm tra file self-host có THỰC SỰ tồn tại không.
 * Backend có SPA fallback: path không tồn tại vẫn trả index.html kèm status 200. Vì vậy phải loại
 * content-type HTML, nếu không sẽ nạp nhầm trang HTML làm model. (Bẫy này đã ghi ở faceLandmarkerClient.js.)
 */
async function fileReallyExists(url) {
    try {
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) return false;
        const type = (res.headers.get('content-type') || '').toLowerCase();
        return !type.includes('text/html');
    } catch {
        return false;
    }
}

async function createWith(delegate, wasmPath, modelUrl) {
    const fileset = await FilesetResolver.forVisionTasks(wasmPath);
    return ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl, delegate },
        runningMode: 'IMAGE',
        outputCategoryMask: false,   // cần alpha mượt để làm mềm viền, không cần nhãn rời rạc
        outputConfidenceMasks: true,
    });
}

/** Nạp (hoặc trả lại) ImageSegmenter dùng chung. */
export async function getPersonSegmenter() {
    if (segmenterPromise) return segmenterPromise;

    segmenterPromise = (async () => {
        const useSelfHost = await fileReallyExists(SELF_HOST_MODEL);
        const wasmPath = useSelfHost ? SELF_HOST_WASM : DEFAULT_WASM_PATH;
        const modelUrl = useSelfHost ? SELF_HOST_MODEL : DEFAULT_MODEL_URL;

        // GPU trước, CPU chỉ là lưới an toàn. Chênh lệch đo được ở ảnh 24MP là 6,4 ms so với
        // 1.265 ms — gấp 197 lần. faceLandmarkerClient.js đang để 'CPU'; ĐỪNG chép sang đây.
        try {
            const seg = await createWith('GPU', wasmPath, modelUrl);
            activeDelegate = 'GPU';
            return seg;
        } catch (gpuErr) {
            console.warn('[Segmenter] GPU delegate hỏng, rơi về CPU (sẽ chậm hơn nhiều):', gpuErr);
            const seg = await createWith('CPU', wasmPath, modelUrl);
            activeDelegate = 'CPU';
            return seg;
        }
    })().catch((err) => {
        segmenterPromise = null; // cho phép thử lại lần sau
        activeDelegate = null;
        throw err;
    });

    return segmenterPromise;
}

/** 'GPU' | 'CPU' | null (chưa nạp). Dùng để quyết định có hạ độ phân giải thêm không. */
export function getActiveDelegate() {
    return activeDelegate;
}

/** Thu ảnh về cạnh dài <= maxEdge, trả canvas. Không phóng to ảnh nhỏ. */
function downscale(source, srcW, srcH, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, w, h);
    return c;
}

/**
 * Tách người khỏi nền.
 * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap} source ảnh đã load xong
 * @param {{ outWidth?: number, outHeight?: number }} opts kích thước mask muốn nhận (mặc định = cỡ ảnh gốc)
 * @returns {Promise<{ mask: Float32Array, width: number, height: number }>}
 *          mask[i] trong [0..1]: 1 = chắc chắn người, 0 = chắc chắn nền.
 */
export async function segmentPerson(source, opts = {}) {
    const srcW = source.naturalWidth || source.videoWidth || source.width;
    const srcH = source.naturalHeight || source.videoHeight || source.height;
    if (!srcW || !srcH) throw new Error('segmentPerson: ảnh chưa có kích thước');

    const outW = opts.outWidth || srcW;
    const outH = opts.outHeight || srcH;

    const seg = await getPersonSegmenter();
    // CPU delegate chậm gấp bội -> hạ thêm một nấc để khách không phải chờ vài giây.
    const maxEdge = activeDelegate === 'CPU' ? 512 : SEG_MAX_EDGE;
    const small = downscale(source, srcW, srcH, maxEdge);

    const result = seg.segment(small);
    try {
        const conf = result.confidenceMasks && result.confidenceMasks[0];
        if (!conf) throw new Error('segmentPerson: không nhận được confidence mask');

        const mw = conf.width;
        const mh = conf.height;
        const raw = conf.getAsFloat32Array(); // độ dài mw*mh, giá trị [0..1]

        // Phóng mask lên kích thước cần bằng canvas (nội suy bilinear của trình duyệt),
        // rẻ hơn nhiều so với tự viết vòng lặp JS trên vài triệu pixel.
        const g = document.createElement('canvas');
        g.width = mw;
        g.height = mh;
        const gctx = g.getContext('2d', { willReadFrequently: true });
        const img = gctx.createImageData(mw, mh);
        for (let i = 0; i < raw.length; i++) {
            const v = Math.max(0, Math.min(255, Math.round(raw[i] * 255)));
            const p = i * 4;
            img.data[p] = v;
            img.data[p + 1] = v;
            img.data[p + 2] = v;
            img.data[p + 3] = 255;
        }
        gctx.putImageData(img, 0, 0);

        const big = document.createElement('canvas');
        big.width = outW;
        big.height = outH;
        const bctx = big.getContext('2d', { willReadFrequently: true });
        bctx.imageSmoothingEnabled = true;
        bctx.imageSmoothingQuality = 'high';
        bctx.drawImage(g, 0, 0, outW, outH);

        const px = bctx.getImageData(0, 0, outW, outH).data;
        const mask = new Float32Array(outW * outH);
        for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4] / 255;

        return { mask, width: outW, height: outH };
    } finally {
        // BẮT BUỘC: không close thì texture WebGL rò qua từng lần chụp.
        result.close();
    }
}
