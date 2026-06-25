// landmarks.js
// Chuyển 478 landmark của MediaPipe Face Landmarker thành một "khung khuôn mặt"
// gồm các điểm neo (anchor) đã đặt tên + kích thước + góc xoay (roll).
// Mọi filter chỉ làm việc với các anchor này, không cần biết chỉ số landmark thô.

// Chỉ số landmark theo chuẩn MediaPipe FaceMesh (468 điểm gốc, 478 nếu bật refine iris).
const IDX = {
    noseTip: 1,        // đầu mũi
    chin: 152,         // đáy cằm
    foreheadTop: 10,   // đỉnh trán (chân tóc giữa)
    glabella: 168,     // điểm giữa hai lông mày
    leftCheek: 234,    // má (mép mặt) bên này
    rightCheek: 454,   // má (mép mặt) bên kia
    eyeAouter: 33,     // khóe mắt ngoài
    eyeAinner: 133,    // khóe mắt trong
    eyeBouter: 263,
    eyeBinner: 362,
    mouthTop: 13,      // môi trên
    mouthBottom: 14,   // môi dưới
    mouthLeft: 61,     // khóe miệng
    mouthRight: 291,
};

const toPx = (pt, w, h) => ({ x: pt.x * w, y: pt.y * h });
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * Tính khung khuôn mặt từ một mảng landmark (đã chuẩn hoá 0..1) + kích thước ảnh px.
 * Trả về object chứa:
 *  - anchors: { left_eye, right_eye, eyes_center, nose, mouth, chin, forehead, head_top, face_center }
 *  - faceWidth, faceHeight (px), interocular (px)
 *  - roll (radian, góc nghiêng đầu trong mặt phẳng ảnh)
 *  - localRight / localDown: vector đơn vị của hệ toạ độ gắn theo đầu (đã xoay theo roll)
 */
export function buildFaceFrame(landmarks, width, height) {
    if (!landmarks || landmarks.length < 468) return null;
    const P = (i) => toPx(landmarks[i], width, height);

    const eyeA = mid(P(IDX.eyeAouter), P(IDX.eyeAinner));
    const eyeB = mid(P(IDX.eyeBouter), P(IDX.eyeBinner));
    // Gán trái/phải theo trục X của ẢNH để không phụ thuộc hướng quay/mirror.
    const [leftEye, rightEye] = eyeA.x <= eyeB.x ? [eyeA, eyeB] : [eyeB, eyeA];

    const nose = P(IDX.noseTip);
    const chin = P(IDX.chin);
    const forehead = P(IDX.foreheadTop);
    const mouth = mid(P(IDX.mouthTop), P(IDX.mouthBottom));
    const eyesCenter = mid(leftEye, rightEye);

    const faceWidth = dist(P(IDX.leftCheek), P(IDX.rightCheek));
    const faceHeight = dist(forehead, chin);
    const interocular = dist(leftEye, rightEye);

    // Góc roll: vector từ mắt trái -> mắt phải.
    const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

    // Hệ toạ độ gắn theo đầu.
    const localRight = { x: Math.cos(roll), y: Math.sin(roll) };
    const localDown = { x: -Math.sin(roll), y: Math.cos(roll) };

    // "Đỉnh đầu": đẩy từ trán lên trên theo hướng đầu (ngược localDown) ~0.55 chiều cao mặt.
    const head_top = {
        x: forehead.x - localDown.x * faceHeight * 0.55,
        y: forehead.y - localDown.y * faceHeight * 0.55,
    };

    return {
        anchors: {
            left_eye: leftEye,
            right_eye: rightEye,
            eyes_center: eyesCenter,
            nose,
            mouth,
            chin,
            forehead,
            head_top,
            // Tâm mặt: hơi dưới mắt một chút (phù hợp đặt má hồng).
            face_center: lerp(eyesCenter, mouth, 0.45),
        },
        faceWidth,
        faceHeight,
        interocular,
        roll,
        localRight,
        localDown,
    };
}

/**
 * Quy đổi một anchor + offset (theo đơn vị tỉ lệ khuôn mặt) thành điểm px tuyệt đối.
 * offset.x: theo bề ngang mặt (+ = sang phải mặt); offset.y: theo chiều cao mặt (+ = xuống).
 */
export function resolveAnchorPoint(frame, anchorName, offset = { x: 0, y: 0 }) {
    const base = frame.anchors[anchorName] || frame.anchors.face_center;
    const dx = (offset.x || 0) * frame.faceWidth;
    const dy = (offset.y || 0) * frame.faceHeight;
    return {
        x: base.x + frame.localRight.x * dx + frame.localDown.x * dy,
        y: base.y + frame.localRight.y * dx + frame.localDown.y * dy,
    };
}

export const ANCHOR_NAMES = [
    'left_eye', 'right_eye', 'eyes_center', 'nose',
    'mouth', 'chin', 'forehead', 'head_top', 'face_center',
];
