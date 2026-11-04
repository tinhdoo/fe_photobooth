import { useEffect, useRef, useState } from 'react';
import { useWorkflow } from '../../context/WorkflowContext';
import { ManKetNoi } from '../remote/BoothRemote';
import {
    choVaoKenh, dongRemote, guiRemote, ketNoiRemote, moRemote, remoteDungDuoc, urlRemote, useKetNoiRemote,
} from '../../remote/remoteBooth';
import { ghiLoi } from '../../utils/doMuot';

// Màn "Chuẩn bị" chèn giữa Thanh toán và Chụp: vừa cho khách đọc thông điệp + tạo dáng,
// vừa PRE-WARM live view Canon (EVF) để khi vào bước Chụp là có hình ngay (không đen lượt đầu).
// Tự chuyển sang Chụp khi camera đã ra hình (tối thiểu MIN_MS để đọc), hoặc sau MAX_MS.
//
// Máy bật "bấm chụp bằng điện thoại" (remoteOn): lượt chụp ĐẦU hiện thêm QR, chờ tới QR_MAX_MS cho khách quét; điện
// thoại nối xong thì vào Chụp sau NOI_XONG_MS. Chụp lại từ Chọn ảnh / điện thoại đã nối thì không hiện QR nữa.
// QR CHỈ hiện khi booth đã vào được kênh Realtime: quá VAO_KENH_MS chưa vào (mạng / Supabase lỗi) thì chạy như máy
// tắt tính năng + ghi lỗi 'remote_loi' (thẻ Độ mượt) -> khách không bao giờ quét phải mã chết.
const QR_MAX_MS = 20000;
const NOI_XONG_MS = 2000;
const VAO_KENH_MS = 3000;

const GetReady = () => {
    const { goToStep, updateSessionData, configs, remoteOn, sessionData } = useWorkflow();
    const isCanon = (configs?.camera_mode || 'canon') === 'canon';

    const MIN_MS = 3000; // hiển thị ~3s để khách kịp đọc + tạo dáng
    const MAX_MS = 6000; // trần: không chờ camera quá lâu

    const laChupLai = sessionData.retakeIndex !== undefined && sessionData.retakeIndex !== null;
    // Chế độ màn: 'dang_mo' (đang vào kênh, tối đa VAO_KENH_MS) -> 'qr' | 'thuong'. Quyết một lần lúc vào màn.
    const [che, setChe] = useState(() => (
        remoteOn && !laChupLai && remoteDungDuoc() && ketNoiRemote() === 'chua' ? 'dang_mo' : 'thuong'
    ));
    const cheRef = useRef(che);
    cheRef.current = che;
    const [qrUrl, setQrUrl] = useState(null);
    const ketNoi = useKetNoiRemote();
    const [conLai, setConLai] = useState(Math.round(QR_MAX_MS / 1000));

    const mountAtRef = useRef(0);
    const doneRef = useRef(false);
    const readyTimerRef = useRef(null);
    // Ref tới <img> live view MJPEG -> để NGẮT kết nối khi rời màn Chuẩn bị.
    const liveImgRef = useRef(null);
    // Cờ ĐỒNG BỘ (ref) đánh dấu live view đã ra hình. Dùng ref thay vì set thẳng cameraWarm=false ở
    // mount + true ở onLoad, vì 2 lệnh setState bất đồng bộ đó ĐUA nhau: khi live view đã pre-warm
    // (frame về gần như tức thì) onLoad có thể chạy TRƯỚC effect mount -> false đè lên true -> cờ kẹt
    // false -> chụp lại luôn hiện màn Chuẩn bị. Giờ cameraWarm chỉ được ghi MỘT LẦN, dứt điểm, ở advance().
    const warmRef = useRef(false);

    const advance = () => {
        if (doneRef.current) return;
        doneRef.current = true;
        // Ghi cờ dứt điểm theo trạng thái thực tại thời điểm chuyển bước (không còn lệnh nào đè lên).
        updateSessionData('cameraWarm', warmRef.current);
        goToStep(4); // vào bước Chụp
    };

    const bayGio = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    useEffect(() => {
        mountAtRef.current = bayGio();
        guiRemote({ buoc: 'chuan_bi', tuChupSau: null, demNguoc: 0 });
        // Giữ tham chiếu <img> ngay trong effect (img luôn ở cùng chỗ trong cây nên không bị dựng lại).
        const liveImg = liveImgRef.current;
        return () => {
            if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
            // NGẮT MJPEG /liveview khi rời màn (mỗi lần Chụp lại đều qua đây). Gán 1 ảnh GIF 1x1
            // buộc trình duyệt HỦY ngay luồng MJPEG; chỉ gỡ <img> (React unmount) KHÔNG đủ để đóng
            // -> kết nối sống dai tích tụ tới trần ~6/host + cạn thread middleware -> ĐƠ khi retake.
            const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
            try { if (liveImg) liveImg.src = BLANK; } catch (e) { /* ignore */ }
        };
    }, []);

    // Vào kênh điện thoại: được thì hiện QR, không thì chạy như cũ.
    useEffect(() => {
        if (che !== 'dang_mo') return undefined;
        let alive = true;
        const p = moRemote();
        (p ? choVaoKenh(VAO_KENH_MS) : Promise.resolve(false)).then((ok) => {
            if (!alive) return;
            if (ok) {
                setQrUrl(urlRemote());
                setChe('qr');
            } else {
                if (p) ghiLoi('remote_loi', 'Không vào được kênh điều khiển bằng điện thoại');
                dongRemote();
                setChe('thuong');
            }
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Hẹn giờ sang Chụp theo chế độ đã chốt. KHÔNG reset cameraWarm ở mount (tránh đua với onLoad). Trạng thái ấm
    // giữ trong warmRef, ghi vào cameraWarm khi advance(); hết giờ mà chưa ra hình thì warmRef=false -> Capture tự
    // chờ frame (hiện overlay như cũ).
    useEffect(() => {
        if (che === 'dang_mo') return undefined;
        const daQua = bayGio() - mountAtRef.current;
        const timers = [];
        let demLui = null;
        if (che === 'qr') {
            timers.push(setTimeout(advance, QR_MAX_MS));
            demLui = setInterval(() => setConLai((s) => Math.max(0, s - 1)), 1000);
        } else {
            timers.push(setTimeout(advance, Math.max(0, MAX_MS - daQua)));
            // Không phải canon (webcam/hotfolder): không có /liveview để dò -> chỉ chờ MIN rồi vào Chụp.
            if (!isCanon) timers.push(setTimeout(advance, Math.max(0, MIN_MS - daQua)));
            else if (warmRef.current) henSangChup(); // live view đã ra hình lúc còn đang vào kênh
        }
        return () => {
            timers.forEach(clearTimeout);
            if (demLui) clearInterval(demLui);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [che]);

    const henSangChup = () => {
        if (doneRef.current || readyTimerRef.current) return;
        const wait = Math.max(0, MIN_MS - (bayGio() - mountAtRef.current));
        readyTimerRef.current = setTimeout(advance, wait);
    };

    // Live view đã ra hình (EVF ấm) -> đánh dấu camera đã sẵn sàng để Capture vào thẳng, KHÔNG
    // hiện overlay "Đang khởi động camera". Vẫn giữ tối thiểu MIN_MS để khách kịp đọc.
    const onLiveReady = () => {
        warmRef.current = true; // đánh dấu đồng bộ; cameraWarm sẽ được ghi dứt điểm trong advance()
        // Đang vào kênh / chờ khách quét QR: sang Chụp khi điện thoại nối / bấm Bắt đầu / hết giờ.
        if (cheRef.current !== 'thuong') return;
        henSangChup();
    };

    // Điện thoại vừa nối -> báo "Đã kết nối" một chút rồi vào Chụp.
    useEffect(() => {
        if (che !== 'qr' || ketNoi !== 'on') return undefined;
        const t = setTimeout(advance, NOI_XONG_MS);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [che, ketNoi]);

    // Pre-warm live view Canon (ẩn): bật EVF cho ấm + dùng onLoad để biết camera đã ra hình -> vào Chụp là có
    // hình ngay. Chỉ áp dụng canon mode.
    const liveAn = isCanon && (
        <img
            ref={liveImgRef}
            src="http://localhost:5001/liveview"
            alt=""
            aria-hidden="true"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: 0, top: 0 }}
            onLoad={onLiveReady}
        />
    );

    // <img> live view luôn là con cuối của cùng một khung -> đổi chế độ màn không dựng lại nó (giữ luồng EVF).
    return (
        <div className="relative h-full w-full">
            {che === 'qr' && qrUrl ? (
                <ManKetNoi
                    qrUrl={qrUrl}
                    trangThai={ketNoi === 'chua' ? 'cho' : 'da_noi'}
                    conLaiGiay={conLai}
                    onBatDau={advance}
                    nenUrl={configs?.['bg_preview-when']}
                />
            ) : (
                <div
                    className="relative w-full h-full flex flex-col items-center justify-center gap-3 bg-[#FFF8E7] bg-cover bg-center p-8 font-serif text-center"
                    style={{ backgroundImage: configs?.['bg_preview-when'] ? `url('${configs['bg_preview-when']}')` : 'none' }}
                >
                    <h1 className="text-3xl md:text-5xl font-extrabold text-[#c1121f] leading-relaxed drop-shadow-sm">
                        Chuẩn bị tạo dáng nha!
                    </h1>
                    {/* Đang vào kênh (thường < 1 s): chưa hứa "vài giây nữa" vì có thể sắp hiện QR. */}
                    {che === 'thuong' && (
                        <h1 className="text-3xl md:text-5xl font-extrabold text-[#c1121f] leading-relaxed drop-shadow-sm">
                            Tomato sẽ bắt đầu chụp sau vài giây nữa!
                        </h1>
                    )}
                </div>
            )}
            {liveAn}
        </div>
    );
};

export default GetReady;
