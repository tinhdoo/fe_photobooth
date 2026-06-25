// faceLandmarkerClient.js
// Bọc MediaPipe FaceLandmarker: nạp model 1 lần (singleton), chạy nhận diện ảnh tĩnh,
// trả về danh sách "khung khuôn mặt" (buildFaceFrame) cho mọi khuôn mặt phát hiện được.

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { buildFaceFrame } from './landmarks.js';

// Có thể tự host wasm + model trong /public để chạy OFFLINE: đặt file vào
//   public/face-filters/mediapipe/wasm/...           (giải nén từ @mediapipe/tasks-vision/wasm)
//   public/face-filters/mediapipe/face_landmarker.task
// rồi đổi 2 hằng dưới sang đường dẫn nội bộ. Mặc định dùng CDN jsDelivr.
const DEFAULT_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const DEFAULT_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const SELF_HOST_WASM = '/face-filters/mediapipe/wasm';
const SELF_HOST_MODEL = '/face-filters/mediapipe/face_landmarker.task';

let landmarkerPromise = null;

// Kiểm tra file self-host có THỰC SỰ tồn tại không.
// Lưu ý: backend có SPA fallback -> path không tồn tại vẫn trả index.html (status 200, text/html).
// Vì vậy phải loại bỏ trường hợp content-type là HTML, nếu không sẽ nạp nhầm HTML làm wasm/model.
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

/** Nạp (hoặc trả lại) instance FaceLandmarker dùng chung. maxFaces: số mặt tối đa. */
export async function getFaceLandmarker({ maxFaces = 5 } = {}) {
    if (landmarkerPromise) return landmarkerPromise;

    landmarkerPromise = (async () => {
        // Ưu tiên file tự host (offline) nếu có, ngược lại dùng CDN.
        const useSelfHost = await fileReallyExists(SELF_HOST_MODEL);
        const wasmPath = useSelfHost ? SELF_HOST_WASM : DEFAULT_WASM_PATH;
        const modelUrl = useSelfHost ? SELF_HOST_MODEL : DEFAULT_MODEL_URL;

        const fileset = await FilesetResolver.forVisionTasks(wasmPath);
        return FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
            runningMode: 'IMAGE',
            numFaces: maxFaces,
            // Bật ma trận biến đổi để có thêm thông tin pose nếu cần mở rộng (yaw/pitch).
            outputFacialTransformationMatrixes: true,
            minFaceDetectionConfidence: 0.4,
            minFacePresenceConfidence: 0.4,
        });
    })().catch((err) => {
        landmarkerPromise = null; // cho phép thử lại lần sau
        throw err;
    });

    return landmarkerPromise;
}

/**
 * Nhận diện khuôn mặt trên 1 ảnh (HTMLImageElement/Canvas/ImageBitmap đã load xong).
 * Trả về { width, height, faces: [frame, ...] }.
 */
export async function detectFaces(imageEl, { maxFaces = 5 } = {}) {
    const landmarker = await getFaceLandmarker({ maxFaces });
    const width = imageEl.naturalWidth || imageEl.width;
    const height = imageEl.naturalHeight || imageEl.height;

    const result = landmarker.detect(imageEl);
    const faces = (result.faceLandmarks || [])
        .map((lm) => buildFaceFrame(lm, width, height))
        .filter(Boolean);

    return { width, height, faces };
}
