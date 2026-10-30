// Viên xúc xắc 3D (three.js) cho trang Xúc xắc ưu đãi: khối bo góc đỏ bóng, chấm trắng lõm (theo ảnh mẫu).
// Kết quả do server quyết; component chỉ diễn: batDauLac() lắc trong lúc chờ API, roi(mat) rơi + nảy rồi dừng đúng
// mặt `mat` hướng về người xem. Chỉ vẽ khi đang chuyển động (máy điện thoại nhân viên không tốn pin lúc đứng yên).
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const MAU_DO = '#b20a14';
const A = 0.28, B = 0.5, C = 0.72;
const CHAM = {
    1: [[B, B]],
    2: [[A, A], [C, C]],
    3: [[A, A], [B, B], [C, C]],
    4: [[A, A], [C, A], [A, C], [C, C]],
    5: [[A, A], [C, A], [B, B], [A, C], [C, C]],
    6: [[A, A], [C, A], [A, B], [C, B], [A, C], [C, C]],
};
// Thứ tự mặt của BoxGeometry: +x, -x, +y, -y, +z, -z. Mặt đối nhau cộng lại bằng 7 như xúc xắc thật.
const MAT_THEO_NHOM = [3, 4, 2, 5, 1, 6];
// Xoay để mặt N quay về phía người xem (+z).
const HUONG_MAT = {
    1: new THREE.Euler(0, 0, 0),
    6: new THREE.Euler(0, Math.PI, 0),
    3: new THREE.Euler(0, -Math.PI / 2, 0),
    4: new THREE.Euler(0, Math.PI / 2, 0),
    2: new THREE.Euler(Math.PI / 2, 0, 0),
    5: new THREE.Euler(-Math.PI / 2, 0, 0),
};
const BAN_KINH_CHAM = 0.1;
const NANG = 0.75;          // nhấc lên bao cao khi lắc
const THOI_GIAN_ROI = 1.5;  // giây

function veMat(mat, kieu) {
    const N = 512;
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const g = c.getContext('2d');
    if (kieu === 'loi') {
        // Bản đồ lồi lõm: trắng = mặt phẳng, đen = lòng chấm (lõm xuống), mép mềm.
        g.fillStyle = '#fff';
        g.fillRect(0, 0, N, N);
        g.filter = 'blur(4px)';
        g.fillStyle = '#000';
        for (const [x, y] of CHAM[mat]) { g.beginPath(); g.arc(x * N, y * N, BAN_KINH_CHAM * N, 0, Math.PI * 2); g.fill(); }
        return c;
    }
    g.fillStyle = MAU_DO;
    g.fillRect(0, 0, N, N);
    for (const [x, y] of CHAM[mat]) {
        const cx = x * N, cy = y * N, r = BAN_KINH_CHAM * N;
        g.fillStyle = '#f3f3f1';
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
        // Bóng trong lòng chấm phía trên-trái: nhìn ra chấm lõm vào thân.
        g.save();
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
        g.shadowColor = 'rgba(60, 10, 10, 0.32)';
        g.shadowBlur = r * 0.3;
        g.shadowOffsetX = r * 0.08;
        g.shadowOffsetY = r * 0.14;
        g.beginPath();
        g.rect(cx - r * 3, cy - r * 3, r * 6, r * 6);
        g.arc(cx, cy, r, 0, Math.PI * 2, true);
        g.fill('evenodd');
        g.restore();
    }
    return c;
}

const easeOutCubic = (u) => 1 - (1 - u) ** 3;
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2);

const XucXac3D = forwardRef(function XucXac3D({ matBanDau = 6, onCham }, ref) {
    const hopRef = useRef(null);
    const dongRef = useRef(null); // trạng thái + hàm điều khiển, sống ngoài React

    useEffect(() => {
        const hop = hopRef.current;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        // Neutral giữ đúng sắc đỏ (ACES làm đỏ ngả cam, nhạt).
        renderer.toneMapping = THREE.NeutralToneMapping;
        renderer.toneMappingExposure = 1;
        hop.appendChild(renderer.domElement);
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';

        const scene = new THREE.Scene();
        const pmrem = new THREE.PMREMGenerator(renderer);
        const moiTruong = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environment = moiTruong;
        scene.environmentIntensity = 0.55;

        const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
        camera.position.set(0, 1.05, 5.4);
        camera.lookAt(0, 0.6, 0);

        const den = new THREE.DirectionalLight(0xffffff, 1.4);
        den.position.set(-2.5, 4, 3);
        scene.add(den);
        scene.add(new THREE.AmbientLight(0xffffff, 0.25));

        const nhom = new THREE.Group();
        scene.add(nhom);

        const hinh = new RoundedBoxGeometry(1, 1, 1, 7, 0.13);
        const anhMau = [];
        const vatLieu = MAT_THEO_NHOM.map((mat) => {
            const map = new THREE.CanvasTexture(veMat(mat, 'mau'));
            map.colorSpace = THREE.SRGBColorSpace;
            map.anisotropy = 4;
            const bumpMap = new THREE.CanvasTexture(veMat(mat, 'loi'));
            anhMau.push(map, bumpMap);
            return new THREE.MeshPhysicalMaterial({
                map, bumpMap, bumpScale: 1, roughness: 0.35, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06,
            });
        });
        const xucXac = new THREE.Mesh(hinh, vatLieu);
        nhom.add(xucXac);

        // Bóng đổ mềm trên mặt bàn (vẽ sẵn, rẻ hơn shadow map).
        const cb = document.createElement('canvas');
        cb.width = 128; cb.height = 128;
        const gb = cb.getContext('2d');
        const grad = gb.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(0,0,0,0.38)');
        grad.addColorStop(0.55, 'rgba(0,0,0,0.16)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        gb.fillStyle = grad;
        gb.fillRect(0, 0, 128, 128);
        const anhBong = new THREE.CanvasTexture(cb);
        const bong = new THREE.Mesh(
            new THREE.PlaneGeometry(1.9, 1.9),
            new THREE.MeshBasicMaterial({ map: anhBong, transparent: true, depthWrite: false }),
        );
        bong.rotation.x = -Math.PI / 2;
        bong.position.y = 0.001;
        scene.add(bong);

        const qMat = (mat, quay = 0) => {
            const q = new THREE.Quaternion().setFromEuler(HUONG_MAT[mat]);
            return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), quay * Math.PI / 2).multiply(q);
        };

        const st = {
            pha: 'nghi',
            q0: qMat(matBanDau),
            truc: new THREE.Vector3(1, 0, 0),
            t0: 0,
            caoLucRoi: 0,
            qBatDau: null,
            qDich: null,
            xong: null,
            raf: 0,
        };
        xucXac.quaternion.copy(st.q0);
        xucXac.position.y = 0.5;

        const datBong = () => {
            const cao = Math.max(0, xucXac.position.y - 0.5);
            const s = 1 - Math.min(0.45, cao * 0.35);
            bong.scale.set(s, s, s);
            bong.material.opacity = 1 - Math.min(0.6, cao * 0.5);
        };
        const ve = () => { datBong(); renderer.render(scene, camera); };

        const khung = (now) => {
            const t = now / 1000;
            if (st.pha === 'lac') {
                const d = t - st.t0;
                const len = easeOutCubic(Math.min(d / 0.25, 1));
                xucXac.position.y = 0.5 + NANG * len + 0.05 * Math.sin(d * 22);
                xucXac.quaternion.setFromAxisAngle(st.truc, 13 * d).multiply(st.q0);
            } else if (st.pha === 'roi') {
                const u = Math.min((t - st.t0) / THOI_GIAN_ROI, 1);
                // Xoay: trộn dần về mặt đích + quay thêm 2 vòng theo trục đang lắc (4π = về đúng chỗ) cho liền mạch.
                const tron = st.qBatDau.clone().slerp(st.qDich, easeInOut(u));
                const goc = -4 * Math.PI * (1 - easeOutCubic(u));
                xucXac.quaternion.setFromAxisAngle(st.truc, goc).multiply(tron);
                // Rơi + nảy 2 lần, mỗi lần thấp dần.
                xucXac.position.y = 0.5 + st.caoLucRoi * (1 - u) ** 2 * Math.abs(Math.cos(2.5 * Math.PI * u));
                if (u >= 1) {
                    xucXac.quaternion.copy(st.qDich);
                    xucXac.position.y = 0.5;
                    st.q0 = st.qDich;
                    st.pha = 'nghi';
                    ve();
                    const xong = st.xong;
                    st.xong = null;
                    xong?.();
                    st.raf = 0;
                    return;
                }
            }
            ve();
            st.raf = requestAnimationFrame(khung);
        };
        const chay = () => { if (!st.raf) st.raf = requestAnimationFrame(khung); };

        const coGian = () => {
            const w = hop.clientWidth || 1, h = hop.clientHeight || 1;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            ve();
        };
        const ro = new ResizeObserver(coGian);
        ro.observe(hop);
        coGian();

        dongRef.current = {
            batDauLac() {
                if (st.pha === 'lac') return;
                st.q0 = xucXac.quaternion.clone();
                st.truc = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.3, Math.random() - 0.5).normalize();
                if (st.truc.lengthSq() < 1e-6) st.truc.set(1, 0, 0);
                st.pha = 'lac';
                st.t0 = performance.now() / 1000;
                chay();
            },
            roi(mat) {
                return new Promise((resolve) => {
                    if (st.pha !== 'lac') {
                        // Gọi thẳng không qua lắc: tung từ chỗ đang nằm.
                        st.q0 = xucXac.quaternion.clone();
                        st.truc = new THREE.Vector3(1, 0, 0.3).normalize();
                    }
                    st.qBatDau = xucXac.quaternion.clone();
                    st.qDich = qMat(mat, Math.floor(Math.random() * 4));
                    st.caoLucRoi = Math.max(0.35, xucXac.position.y - 0.5);
                    st.pha = 'roi';
                    st.t0 = performance.now() / 1000;
                    st.xong = resolve;
                    chay();
                });
            },
        };

        return () => {
            cancelAnimationFrame(st.raf);
            ro.disconnect();
            dongRef.current = null;
            hinh.dispose();
            vatLieu.forEach((m) => m.dispose());
            anhMau.forEach((tx) => tx.dispose());
            anhBong.dispose();
            bong.geometry.dispose();
            bong.material.dispose();
            moiTruong.dispose();
            pmrem.dispose();
            renderer.dispose();
            renderer.domElement.remove();
        };
        // matBanDau chỉ dùng lúc dựng cảnh.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
        batDauLac: () => dongRef.current?.batDauLac(),
        roi: (mat) => dongRef.current?.roi(mat) ?? Promise.resolve(),
    }), []);

    return <div ref={hopRef} onClick={onCham} className="h-full w-full cursor-pointer" role="img" aria-label="Xúc xắc" />;
});

export default XucXac3D;
