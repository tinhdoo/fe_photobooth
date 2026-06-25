// geometry.js
// Trích "hình học khuôn mặt" giàu thông tin từ 478 landmark MediaPipe Face Mesh:
//  - points: các điểm neo (chuẩn hoá 0..1) để đặt tâm warp / makeup
//  - metrics: kích thước đã hiệu chỉnh tỉ lệ ảnh (aspect) để bán kính warp ổn định
//  - rings: các vòng polygon (mặt, mắt, môi) để tạo mask làm đẹp
// Tất cả filter chỉ làm việc với dữ liệu này, không đụng chỉ số landmark thô.

// Vòng silhouette khuôn mặt (FACEMESH_FACE_OVAL) theo thứ tự.
const FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
    378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
    162, 21, 54, 103, 67, 109,
];
const LEFT_EYE_RING = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const RIGHT_EYE_RING = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];
const LIPS_RING = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];

const IDX = {
    eyeAouter: 33, eyeAinner: 133,
    eyeBouter: 263, eyeBinner: 362,
    noseTip: 1, noseBridge: 168,
    chin: 152, forehead: 10,
    cheekBoneL: 234, cheekBoneR: 454,
    cheekL: 50, cheekR: 280,
    mouthTop: 13, mouthBottom: 14,
};

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Khoảng cách đã hiệu chỉnh aspect (x nhân aspect để đồng đơn vị với y).
const distA = (a, b, aspect) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

const ring = (landmarks, indices) => indices.map((i) => ({ x: landmarks[i].x, y: landmarks[i].y }));

/**
 * @param landmarks mảng 478 điểm {x,y,z} chuẩn hoá 0..1
 * @param aspect    width/height của ảnh
 */
export function buildFaceGeometry(landmarks, aspect) {
    if (!landmarks || landmarks.length < 468) return null;
    const P = (i) => ({ x: landmarks[i].x, y: landmarks[i].y });

    const eyeA = mid(P(IDX.eyeAouter), P(IDX.eyeAinner));
    const eyeB = mid(P(IDX.eyeBouter), P(IDX.eyeBinner));
    const [leftEye, rightEye] = eyeA.x <= eyeB.x ? [eyeA, eyeB] : [eyeB, eyeA];
    const eyesCenter = mid(leftEye, rightEye);

    const noseTip = P(IDX.noseTip);
    const noseBridge = P(IDX.noseBridge);
    const chin = P(IDX.chin);
    const forehead = P(IDX.forehead);
    const mouth = mid(P(IDX.mouthTop), P(IDX.mouthBottom));
    const faceCenter = lerp(eyesCenter, mouth, 0.5);
    const headCenter = lerp(forehead, chin, 0.4);

    const eyeWidthL = distA(P(IDX.eyeAouter), P(IDX.eyeAinner), aspect);
    const eyeWidthR = distA(P(IDX.eyeBouter), P(IDX.eyeBinner), aspect);

    return {
        points: {
            leftEye, rightEye, eyesCenter,
            nose: noseTip, noseBridge,
            chin, forehead, mouth,
            cheekLeft: P(IDX.cheekL),
            cheekRight: P(IDX.cheekR),
            faceCenter, headCenter,
        },
        metrics: {
            faceW: distA(P(IDX.cheekBoneL), P(IDX.cheekBoneR), aspect),
            faceH: distA(forehead, chin, aspect),
            eyeW: (eyeWidthL + eyeWidthR) / 2,
            interoc: distA(leftEye, rightEye, aspect),
        },
        rings: {
            faceOval: ring(landmarks, FACE_OVAL),
            leftEye: ring(landmarks, LEFT_EYE_RING),
            rightEye: ring(landmarks, RIGHT_EYE_RING),
            lips: ring(landmarks, LIPS_RING),
        },
    };
}
