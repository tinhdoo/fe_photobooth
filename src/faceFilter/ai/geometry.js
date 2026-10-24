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
// Viền môi TRONG (khoang miệng) — để tô son CHỪA răng/lưỡi khi cười hở (mask = viền ngoài - viền trong).
const INNER_LIPS_RING = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
// Lông mày — để KHÔNG làm mịn/không nâng sáng lên mày (giữ nét mày sắc).
const BROW_A_RING = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const BROW_B_RING = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];

// Mống mắt (chỉ có khi model bật refine landmarks -> 478 điểm).
const IRIS_A_CENTER = 468;
const IRIS_A_EDGE = [469, 470, 471, 472];
const IRIS_B_CENTER = 473;
const IRIS_B_EDGE = [474, 475, 476, 477];

const IDX = {
    eyeAouter: 33, eyeAinner: 133,
    eyeBouter: 263, eyeBinner: 362,
    noseTip: 1, noseBridge: 168,
    chin: 152, forehead: 10,
    cheekBoneL: 234, cheekBoneR: 454,
    cheekL: 50, cheekR: 280,
    mouthTop: 13, mouthBottom: 14,
    noseBottom: 2, alaLeft: 64, alaRight: 294,
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

    // Mống mắt: cần cho việc chỉ làm trắng LÒNG TRẮNG và đặt catchlight đúng tâm tròng đen.
    // Model 478 điểm mới có; thiếu thì trả null để bên dùng tự lùi về phương án cũ.
    const hasIris = landmarks.length >= 478;
    const irisRadius = (center, edge) =>
        edge.reduce((s, i) => s + distA(P(center), P(i), aspect), 0) / edge.length;
    const irisA = hasIris ? P(IRIS_A_CENTER) : null;
    const irisB = hasIris ? P(IRIS_B_CENTER) : null;
    // Gán trái/phải theo trục X của ẢNH, khớp cách gán leftEye/rightEye ở trên.
    const swapped = irisA && irisB ? irisA.x > irisB.x : false;
    const irisLeft = swapped ? irisB : irisA;
    const irisRight = swapped ? irisA : irisB;
    const irisLeftR = hasIris ? irisRadius(swapped ? IRIS_B_CENTER : IRIS_A_CENTER, swapped ? IRIS_B_EDGE : IRIS_A_EDGE) : null;
    const irisRightR = hasIris ? irisRadius(swapped ? IRIS_A_CENTER : IRIS_B_CENTER, swapped ? IRIS_A_EDGE : IRIS_B_EDGE) : null;

    // Lỗ mũi: xấp xỉ giữa đáy mũi và cánh mũi mỗi bên (đủ để chừa ra khỏi mask làm mịn).
    const noseBottom = P(IDX.noseBottom);
    const nostrilLeft = mid(noseBottom, P(IDX.alaLeft));
    const nostrilRight = mid(noseBottom, P(IDX.alaRight));

    return {
        points: {
            leftEye, rightEye, eyesCenter,
            nose: noseTip, noseBridge,
            chin, forehead, mouth,
            cheekLeft: P(IDX.cheekL),
            cheekRight: P(IDX.cheekR),
            faceCenter, headCenter,
            irisLeft, irisRight,
            nostrilLeft, nostrilRight,
        },
        metrics: {
            faceW: distA(P(IDX.cheekBoneL), P(IDX.cheekBoneR), aspect),
            faceH: distA(forehead, chin, aspect),
            eyeW: (eyeWidthL + eyeWidthR) / 2,
            interoc: distA(leftEye, rightEye, aspect),
            irisLeftR, irisRightR,
            // Góc nghiêng đầu trong mặt phẳng ảnh (đã hiệu chỉnh aspect).
            roll: Math.atan2(rightEye.y - leftEye.y, (rightEye.x - leftEye.x) * aspect),
        },
        rings: {
            faceOval: ring(landmarks, FACE_OVAL),
            leftEye: ring(landmarks, LEFT_EYE_RING),
            rightEye: ring(landmarks, RIGHT_EYE_RING),
            lips: ring(landmarks, LIPS_RING),
            innerLips: ring(landmarks, INNER_LIPS_RING),
            leftBrow: ring(landmarks, swapped ? BROW_B_RING : BROW_A_RING),
            rightBrow: ring(landmarks, swapped ? BROW_A_RING : BROW_B_RING),
        },
    };
}

/**
 * Loại khuôn mặt nhận nhầm: mặt nhỏ nằm LỌT bên trong một mặt lớn hơn nhiều
 * (thường do gọng kính / hoạ tiết áo / phản chiếu). Nếu để nguyên, makeup sẽ bị
 * vẽ chồng lên giữa mặt thật thành đốm màu lạ.
 */
export function selectFaces(faces, { minRatio = 0.45 } = {}) {
    if (!Array.isArray(faces) || faces.length < 2) return faces || [];
    const big = faces.reduce((a, b) => (a.metrics.faceW >= b.metrics.faceW ? a : b));
    const xs = big.rings.faceOval.map((p) => p.x);
    const ys = big.rings.faceOval.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    return faces.filter((f) => {
        if (f === big) return true;
        if (f.metrics.faceW >= big.metrics.faceW * minRatio) return true; // đủ lớn -> là người thật
        const c = f.points.faceCenter;
        const inside = c.x > x0 && c.x < x1 && c.y > y0 && c.y < y1;
        return !inside;
    });
}
