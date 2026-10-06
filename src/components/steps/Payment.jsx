import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useRef } from 'react';
import { ArrowLeft, Banknote, Hash, Loader2, QrCode } from 'lucide-react';
import { io } from 'socket.io-client';
import { useWorkflow } from '../../context/WorkflowContext';
import { getDeviceId } from '../../utils/deviceId';
import { errorMessage } from '../../utils/errorMessage';

const formatVnd = (value) => `${Math.max(value, 0).toLocaleString('vi-VN')} VNĐ`;
import { API_URL, CLOUD_API_URL } from '../../config/api';
// Máy đọc tiền là phần cứng LOCAL (serial trên booth) -> luôn gọi backend local.
const LOCAL_API_URL = API_URL;

const Payment = () => {
    const { nextStep, prevStep, sessionData, updateSessionData, configs } = useWorkflow();
    const [method, setMethod] = useState(null);
    const [loading, setLoading] = useState(false);
    const [cashInserted, setCashInserted] = useState(0);
    const [code, setCode] = useState('');
    const [voucher, setVoucher] = useState(null);
    const [qrOrder, setQrOrder] = useState(null);
    const [qrError, setQrError] = useState('');
    // MỌI đơn chuyển khoản đã tạo trong bước Thanh toán này {code, amount, paid, order}, được theo dõi tới
    // khi rời bước — kể cả khi khách đã bấm Quay lại. Trước 0.0.23 Quay lại là bỏ theo dõi đơn: khách quét
    // + chuyển rồi Quay lại, chọn lại thì booth tạo đơn MỚI -> khoản chuyển đầu không được tính, khách có
    // thể trả hai lần. Giờ chọn lại chuyển khoản thì hiện lại đúng đơn cũ (cùng số tiền).
    const donQrRef = useRef([]);
    // Các đơn ĐÃ TRẢ {code, amount}: tiền chuyển khoản đã nhận, cộng chung với tiền mặt + mã.
    const [donDaTra, setDonDaTra] = useState([]);
    const [errorModal, setErrorModal] = useState({ show: false, message: '' });
    // Trạng thái máy đọc tiền trên màn tiền mặt. Cổng COM chỉ mở KHI khách chọn tiền mặt (kết nối
    // theo nhu cầu) nên lúc vào màn chưa biết máy có nối được không: null = đang kết nối,
    // {status:'connected'} = sẵn sàng, {status:'error', message} = lỗi -> khách biết mà đổi sang mã
    // thay vì đứng nhét tiền vào máy chết (sự cố 2026-09-11).
    const [billStatus, setBillStatus] = useState(null);
    // Tờ tiền ĐANG CHỜ CHỐT (backend nhận tiền bất đồng bộ): máy vừa nhận mã mệnh giá, tiền CHỈ được
    // cộng khi máy báo tờ đã vào thùng (hoặc hẹn giờ hết). null | {amount, status:'dang_nhan'|'tra_lai'}.
    // Trong lúc 'dang_nhan' khoá nút Quay lại và không tự sang bước chụp -> không bao giờ tính một tờ
    // chưa chắc chắn (sự cố đếm trùng 2026-09-22/25).
    const [billPending, setBillPending] = useState(null);
    // Khách đã nhét tiền mà bấm Quay lại ở màn chọn phương thức (rời bước Thanh toán) -> hỏi lại, vì
    // rời bước là mất số tiền đó trên màn hình.
    const [xacNhanRoi, setXacNhanRoi] = useState(false);
    const qrRequestRef = useRef(0);
    // Refs giữ GIÁ TRỊ MỚI NHẤT cho socket handler. Socket chỉ tạo 1 lần (deps []), nếu đọc
    // trực tiếp method/qrOrder/handlePaymentSuccess trong closure sẽ phải tạo lại socket mỗi lần
    // cộng tiền -> disconnect/reconnect liên tục -> có thể MẤT tờ tiền nhét đúng lúc reconnect.
    const methodRef = useRef(method);
    const cashRef = useRef(0);
    // Vết byte máy đọc tiền của phiên tiền mặt (backend gửi kèm money_inserted). Lưu vào phiên chụp để
    // sự cố đếm tiền sau này đọc được từ cloud (meta cash_trace) thay vì đoán.
    const cashTraceRef = useRef(null);
    // Chốt CHỐNG GỌI TRÙNG handlePaymentSuccess. Một giao dịch có thể bị kích hoạt nhiều lần từ
    // nhiều nguồn (QR: Supabase realtime + poll 2.5s + socket SePay; tiền mặt: nhiều tờ dồn dập)
    // -> nếu không chặn sẽ gọi nextStep() nhiều lần / lặp API voucher lỗi. Chỉ mở lại khi khách
    // ĐÓNG modal lỗi (thử lại có chủ đích), còn khi thành công thì giữ khoá tới lúc rời bước.
    const processingRef = useRef(false);
    // ĐANG XỬ LÝ thanh toán thành công (từ lúc gọi handlePaymentSuccess tới khi sang bước chụp, hoặc tới
    // khi báo lỗi): hiện màn "Đang xử lý" + chặn Quay lại. Không dùng chung cờ loading: nhập mã đủ giá
    // thì applyCode đặt loading=false ngay sau đó (React gộp hai lần đặt) -> trước 0.0.22 màn chọn phương
    // thức vẫn bấm được, khách Quay lại đúng lúc -> mã bị dùng mà lượt chụp không tính.
    const [dangXuLy, setDangXuLy] = useState(false);
    const dangXuLyRef = useRef(false);
    const datXuLy = useCallback((value) => {
        dangXuLyRef.current = value;
        setDangXuLy(value);
    }, []);
    // Mã LƯỢT riêng gửi kèm lệnh dùng mã: lần dùng trước thành công mà mất phản hồi thì gửi lại vẫn được
    // cloud báo thành công (thay vì "đã được sử dụng" lặp mãi). Edit sau đó gắn mã với album thật.
    const luotIdRef = useRef(null);
    if (!luotIdRef.current) {
        if (window.crypto?.randomUUID) {
            luotIdRef.current = window.crypto.randomUUID();
        } else {
            const b = new Uint8Array(16);
            window.crypto.getRandomValues(b);
            b[6] = (b[6] & 0x0f) | 0x40;
            b[8] = (b[8] & 0x3f) | 0x80;
            const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
            luotIdRef.current = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
        }
    }
    // Ref tới <img> live view MJPEG (pre-warm) -> để NGẮT kết nối khi rời bước Thanh toán. Giống
    // GetReady: chỉ gỡ <img> (React unmount) KHÔNG đủ đóng luồng MJPEG -> kết nối sống dai tích tụ
    // tới trần ~6/host + cạn thread middleware -> ĐƠ (và giữ EVF nóng). Phải gán blank-GIF để đóng.
    const liveImgRef = useRef(null);

    const price = sessionData.printPrice || 60000;
    const printQuantity = sessionData.printQuantity || 1;
    const voucherValue = Math.min(voucher?.value || 0, price);
    const remainingAmount = Math.max(price - voucherValue, 0);
    // Tiền chuyển khoản đã nhận (các đơn QR đã trả).
    const qrDaTra = donDaTra.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
    // Còn thiếu sau khi trừ mã, tiền mặt đã nhét VÀ chuyển khoản đã nhận (tiền được giữ khi khách đổi
    // phương thức).
    const conLai = Math.max(remainingAmount - cashInserted - qrDaTra, 0);
    // Phần tiền mặt cần nhét (màn tiền mặt): sau mã và chuyển khoản.
    const mucTienMat = Math.max(remainingAmount - qrDaTra, 0);
    const cashProgressTotal = mucTienMat || price;
    const primaryTextColor = configs?.brand_text_primary || '#7B5E43';
    const secondaryTextColor = configs?.brand_text_secondary || '#5E6B78';

    // Đánh dấu một đơn QR của bước này đã trả (từ vòng hỏi trạng thái hoặc socket SePay). Mỗi đơn chỉ
    // cộng một lần.
    const danhDauDaTra = useCallback((maDon) => {
        const don = donQrRef.current.find((d) => d.code === maDon);
        if (!don || don.paid) return;
        don.paid = true;
        setDonDaTra((prev) => [...prev, { code: don.code, amount: don.amount }]);
    }, []);

    const handlePaymentSuccess = useCallback((baseMethod, extraData = {}) => {
        // Đã có một lượt xử lý đang chạy (hoặc lỗi chưa được khách bấm Đóng) -> bỏ qua lời gọi trùng.
        if (processingRef.current) return;
        processingRef.current = true;
        // Mã chỉ che PHẦN CÒN THIẾU sau tiền mặt + chuyển khoản -> doanh thu tiền mặt / QR khớp đúng số
        // tiền thu được. Tiền mặt + chuyển khoản đã đủ cả giá thì KHÔNG dùng mã (mã còn nguyên cho khách).
        const nhapMa = extraData.voucher || voucher;
        const activeVoucherValue = Math.max(Math.min(nhapMa?.value || 0, price - cashInserted - qrDaTra), 0);
        const activeVoucher = activeVoucherValue > 0 ? nhapMa : null;
        // Phương thức = các nguồn tiền THỰC SỰ dùng, theo thứ tự code, cash, qr: 'cash', 'qr', 'code',
        // 'code+cash', 'code+qr', và từ 0.0.23 'cash+qr', 'code+cash+qr' (trang Doanh thu tách phần tiền
        // mặt theo cash_inserted).
        const phuongThuc = [activeVoucher && 'code', cashInserted > 0 && 'cash', qrDaTra > 0 && 'qr']
            .filter(Boolean).join('+') || baseMethod || method || 'cash';
        datXuLy(true);
        setLoading(true);
        setTimeout(async () => {
            if (activeVoucher?.id && !activeVoucher.used) {
                try {
                    await axios.post(`${CLOUD_API_URL}/api/codes`, {
                        action: 'use',
                        id: activeVoucher.id,
                        session_id: luotIdRef.current,
                    }, { timeout: 15000 });
                    setVoucher((prev) => prev?.id === activeVoucher.id ? { ...prev, used: true } : prev);
                } catch (error) {
                    setLoading(false);
                    datXuLy(false);
                    // boMa: cho khách BỎ mã này để trả phần còn lại bằng cách khác (mã hết hạn / bị dùng ở
                    // lượt khác) — trước 0.0.22 không có lối ra: bấm Đóng là thử lại, lỗi lại, mãi mãi.
                    setErrorModal({
                        show: true,
                        boMa: true,
                        message: errorMessage(error, 'Không thể sử dụng mã thanh toán. Vui lòng thử lại.')
                    });
                    return;
                }
            }

            setLoading(false);
            updateSessionData('paymentMethod', phuongThuc);
            updateSessionData('paymentStatus', 'completed');
            updateSessionData('paymentTotal', price);
            updateSessionData('paymentPaidAmount', price);
            if (activeVoucher) {
                updateSessionData('paymentCode', activeVoucher.code);
                updateSessionData('paymentCodeValue', activeVoucher.value);
                updateSessionData('paymentCodeApplied', activeVoucherValue);
                // Lưu ID mã đã dùng -> Edit sẽ gắn nó với sessionId (album) để biết "mã dùng cho lượt nào".
                if (activeVoucher.id) updateSessionData('paymentCodeId', activeVoucher.id);
            } else {
                // Không dùng mã (tiền mặt đủ cả giá, hoặc khách đã bỏ mã): xoá mọi dấu mã còn sót trong phiên.
                // Trước 0.0.22 applyCode ghi mã vào phiên ngay lúc kiểm tra; khách rời bước Thanh toán rồi
                // quay lại trả tiền mặt thì phiên vẫn mang payment_code_applied cũ -> doanh thu bị trừ oan.
                updateSessionData('paymentCode', null);
                updateSessionData('paymentCodeValue', null);
                updateSessionData('paymentCodeApplied', null);
                updateSessionData('paymentCodeId', null);
            }
            if (cashInserted > 0) updateSessionData('cashInserted', cashInserted);
            if (cashInserted > 0 && cashTraceRef.current) updateSessionData('cashTrace', cashTraceRef.current);
            if (donDaTra.length) {
                updateSessionData('sepayOrderCode', donDaTra[0].code);
                // Số tiền chuyển khoản THỰC nhận (có thể hơn phần còn thiếu: khách trả đơn cũ sau khi đã nhét
                // thêm tiền mặt) -> đối soát hoàn tiền thừa từ trang Doanh thu.
                updateSessionData('qrPaid', qrDaTra);
                // Hiếm: trả bằng HAI đơn (vd bỏ mã sau khi đã chuyển một phần) -> cloud ghép đủ các đơn vào
                // lượt này, không tính đơn thứ hai thành giao dịch riêng.
                if (donDaTra.length > 1) updateSessionData('sepayOrderCodes', donDaTra.map((d) => d.code));
            }
            nextStep();
        }, 500);
    }, [cashInserted, datXuLy, donDaTra, method, nextStep, price, qrDaTra, updateSessionData, voucher]);

    // Cập nhật ref mỗi render để socket handler (tạo 1 lần) luôn thấy giá trị hiện tại.
    methodRef.current = method;
    cashRef.current = cashInserted;

    // Đối chiếu tiền mặt với sổ của backend theo mã lượt: money_inserted bị lỡ (socket nối lại đúng lúc
    // chốt tờ) thì tờ đó vẫn được cộng. Chỉ TĂNG, không bao giờ giảm số trên màn hình.
    const doiChieuTienMat = useCallback(async () => {
        try {
            const { data } = await axios.get(`${LOCAL_API_URL}/api/bill/status`, {
                params: { luot: luotIdRef.current },
                timeout: 3000,
            });
            const tong = Number(data?.tong_luot);
            if (!Number.isFinite(tong) || tong <= cashRef.current) return;
            console.warn(`[Payment] doi chieu tien mat: man hinh ${cashRef.current}, backend ${tong} -> lay ${tong}`);
            cashRef.current = tong;
            setCashInserted((prev) => Math.max(prev, tong));
            setBillPending(null);
        } catch (e) {
            // backend chưa trả lời -> lần sau
        }
    }, []);

    const applyCode = async () => {
        if (code.length !== 6 || voucher || loading) return;

        setLoading(true);
        try {
            const res = await axios.post(`${CLOUD_API_URL}/api/codes`, { action: 'validate', code });
            if (!res.data.valid || res.data.value <= 0) {
                setErrorModal({ show: true, message: 'Mã không hợp lệ hoặc không còn giá trị.' });
                return;
            }

            const appliedVoucher = {
                id: res.data.id,
                code,
                value: res.data.value,
                used: false
            };
            // Mã chỉ ghi vào phiên khi thanh toán XONG (handlePaymentSuccess), không ghi lúc kiểm tra.
            setVoucher(appliedVoucher);
            setCode('');
            setMethod(null);
            // GIỮ tiền mặt đã nhét (trước đây đặt về 0 -> khách mất số tiền đó). Mã + tiền mặt đủ giá
            // -> xong luôn ('code+cash'), mã chỉ che phần còn thiếu.
            setQrOrder(null);
            setQrError('');

            if (res.data.value + cashInserted + qrDaTra >= price) {
                handlePaymentSuccess(cashInserted > 0 ? 'cash' : 'code', { voucher: appliedVoucher });
            }
        } catch (error) {
            setErrorModal({
                show: true,
                message: errorMessage(error, 'Không thể xử lý mã thanh toán. Vui lòng thử lại.')
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // KHÔNG giới hạn số lần nối lại: trước 0.0.23 là 5 lần -> backend khởi động lại lâu hơn ~15 s thì
        // socket bỏ cuộc vĩnh viễn, khách nhét tiền mà màn hình không bao giờ cộng.
        const socket = io('/', {
            transports: ['polling'],
            auth: { deviceId: getDeviceId() }
        });

        socket.on('connect_error', (err) => {
            console.warn('Socket connection error:', err.message);
        });

        // Mỗi lần (nối lại) được -> đối chiếu tiền mặt: tờ chốt trong lúc mất kết nối không bị bỏ sót.
        socket.on('connect', () => {
            doiChieuTienMat();
        });

        socket.on('money_inserted', (data) => {
            // Cổng máy đọc tiền CHỈ mở ở màn tiền mặt, nên mọi money_inserted là tiền khách nhét ở bước
            // này — kể cả tờ được chốt ngay SAU khi khách rời màn tiền mặt (stop() chốt tờ đang chờ).
            // Ghi nhận ở mọi màn của bước Thanh toán: tiền đã nhận được GIỮ khi khách đổi phương thức.
            const luot = data?.luot;
            if (luot && luot !== luotIdRef.current) {
                // Tờ của một lượt thanh toán KHÁC (backend gắn mã lượt từ lệnh mở cổng) -> không cộng.
                console.warn('[Payment] money_inserted cua luot khac -> bo qua', data?.amount);
                return;
            }
            const tong = Number(data?.tong_luot);
            if (luot && Number.isFinite(tong)) {
                // Backend gửi TỔNG của lượt -> lấy tổng (đã gồm cả tờ lỡ sự kiện trước đó, nếu có).
                cashRef.current = Math.max(cashRef.current, tong);
                setCashInserted((prev) => Math.max(prev, tong));
            } else {
                setCashInserted((prev) => prev + (Number(data?.amount) || 0));
            }
            setBillPending(null);
            if (Array.isArray(data?.trace)) cashTraceRef.current = data.trace;
        });

        socket.on('bill_pending', (data) => {
            // dang_nhan: đã ACK, chờ máy xác nhận tờ vào thùng; tra_lai: máy trả tờ ra, chờ khách nhét
            // lại; huy: bỏ tờ đó (không cộng). Tiền được cộng qua money_inserted.
            if (methodRef.current !== 'cash' || !data) return;
            if (data.status === 'dang_nhan' || data.status === 'tra_lai') {
                setBillPending({ amount: data.amount || 0, status: data.status });
            } else {
                setBillPending(null);
            }
        });

        socket.on('sepay_payment_success', (data) => {
            // Mọi đơn của bước này (không chỉ đơn đang hiện); việc chuyển bước do effect "đủ tiền" lo.
            if (data?.order_code) danhDauDaTra(data.order_code);
        });

        socket.on('bill_status', (data) => {
            // Backend emit khi vòng đọc mở được cổng ('connected'), mở thất bại / lỗi giữa chừng
            // ('error'), hoặc máy đọc tiền đang tắt trong cài đặt ('disabled'). Chỉ quan tâm khi đang
            // ở màn tiền mặt; ngoài màn đó cổng vốn đã đóng.
            if (methodRef.current === 'cash' && data && ['connected', 'error', 'disabled'].includes(data.status)) {
                setBillStatus({ status: data.status, message: data.message || '', port: data.port || '' });
            }
        });

        // Tạo socket 1 LẦN cho suốt vòng đời bước Thanh toán (deps ổn định): handler đọc qua ref nên
        // luôn thấy method / số tiền mới nhất mà KHÔNG cần dựng lại socket.
        return () => socket.disconnect();
    }, [danhDauDaTra, doiChieuTienMat]);

    // NGẮT luồng MJPEG /liveview khi rời bước Thanh toán (gán blank-GIF, giống GetReady) -> tránh
    // kết nối sống dai tích tụ gây đơ + giữ EVF nóng. Chạy 1 lần, đóng ở cleanup.
    useEffect(() => {
        const liveImg = liveImgRef.current;
        return () => {
            const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
            try { if (liveImg) liveImg.src = BLANK; } catch (e) { /* ignore */ }
        };
    }, []);

    useEffect(() => {
        // Đủ tiền mặt -> tự hoàn tất. Chống gọi trùng đã do processingRef trong handlePaymentSuccess
        // lo (nhét nhiều tờ dồn dập cũng chỉ chạy 1 lần). !loading + !errorModal.show: không tự chạy
        // khi đang xử lý hoặc đang hiện modal lỗi; khi khách bấm Đóng (errorModal.show -> false) effect
        // chạy lại -> thử lại có chủ đích, không lặp vô hạn.
        // Còn tờ đang chờ chốt -> đợi nó (cộng vào hoặc bị bỏ) rồi mới đi tiếp, kẻo tờ đó rơi ra ngoài
        // tổng tiền của lượt.
        // Cả ở màn chọn phương thức (tờ chốt muộn sau khi khách rời màn tiền mặt, hoặc mã + tiền mặt đủ
        // giá mà lần dùng mã trước bị lỗi) — tiền mặt không chạy ở màn QR / nhập mã. Chuyển khoản đã
        // nhận thì chạy ở MỌI màn: đơn QR được theo dõi cả khi khách đã Quay lại (0.0.23).
        const dangNhan = billPending?.status === 'dang_nhan';
        const choTienMat = method === 'cash' || !method;
        const daTra = cashInserted + qrDaTra;
        if ((choTienMat || qrDaTra > 0) && !loading && !errorModal.show && !dangNhan && daTra > 0 && daTra >= remainingAmount) {
            handlePaymentSuccess(qrDaTra > 0 ? 'qr' : 'cash');
        }
    }, [billPending, cashInserted, errorModal.show, handlePaymentSuccess, loading, method, qrDaTra, remainingAmount]);

    // Lưới an toàn: backend luôn chốt tờ trong ≤ 10 s (hẹn giờ). Mất sự kiện (socket reconnect) thì sau
    // 15 s mở khoá nút Quay lại (và đối chiếu với sổ backend), không để khách kẹt ở màn tiền mặt.
    useEffect(() => {
        if (!billPending) return undefined;
        const t = setTimeout(() => {
            setBillPending(null);
            doiChieuTienMat();
        }, 15000);
        return () => clearTimeout(t);
    }, [billPending, doiChieuTienMat]);

    // Ở màn tiền mặt: đối chiếu định kỳ với sổ backend (rẻ: không đụng cổng COM) — lưới an toàn cho mọi
    // money_inserted bị lỡ mà socket không hề báo mất kết nối.
    useEffect(() => {
        if (method !== 'cash') return undefined;
        const t = setInterval(doiChieuTienMat, 5000);
        return () => clearInterval(t);
    }, [method, doiChieuTienMat]);

    // Gửi trạng thái nhận tiền TUẦN TỰ: một request đang bay tại một thời điểm, xong thì gửi trạng
    // thái MỚI NHẤT nếu đã đổi. Vì sao: React chạy cleanup (false) rồi effect (true) trong cùng một
    // nhịp -> hai POST bay song song trên hai kết nối; backend eventlet xử lý theo thứ tự socket sẵn
    // sàng chứ không theo thứ tự gửi -> có thể "true" chạy trước "false" -> cổng vừa mở đã bị đóng,
    // khách đứng ở màn tiền mặt mà máy không nhận. Từ khi kết nối theo nhu cầu, false = ĐÓNG CỔNG nên
    // sai thứ tự là mất hẳn phiên nhận tiền chứ không chỉ tắt LED.
    const billWantRef = useRef(false);
    const billInFlightRef = useRef(false);
    const sendBillAccept = useCallback((want) => {
        billWantRef.current = want;
        if (billInFlightRef.current) return;
        const fire = () => {
            const value = billWantRef.current;
            billInFlightRef.current = true;
            // timeout BẮT BUỘC: Chrome chỉ cho 6 kết nối tới một host. Đã xảy ra thật (2026-09-11): backend
            // treo ở lệnh ghi serial, 5 request này không bao giờ được trả lời -> cạn 6 slot -> lệnh in của
            // khách không rời được trình duyệt -> "timeout of 30000ms exceeded". Có timeout thì axios huỷ
            // request sau 5 s và Chrome trả lại slot, dù backend có kẹt đến đâu.
            axios.post(`${LOCAL_API_URL}/api/bill/accept`, { accepting: value, luot: luotIdRef.current }, { timeout: 5000 })
                .catch(() => {})
                .then(() => {
                    billInFlightRef.current = false;
                    if (billWantRef.current !== value) fire();
                });
        };
        fire();
    }, []);

    // Máy đọc tiền (mở cổng + LED + cho nhét tiền) CHỈ bật khi đang Ở MÀN "Đưa tiền vào khe":
    // đã chọn tiền mặt, còn phải trả, và không đang xử lý. Mọi trạng thái khác (mới vào
    // Payment, màn chọn phương thức, QR, nhập mã, đang xử lý, rời bước) -> chủ động TẮT (= đóng cổng).
    // Còn phải trả = conLai (sau mã, tiền mặt, chuyển khoản): đủ tiền thì đóng cổng ngay, không nhận thừa.
    const conPhaiTra = conLai > 0;
    useEffect(() => {
        const onCashScreen = method === 'cash' && conPhaiTra && !loading && !dangXuLy;
        sendBillAccept(onCashScreen);
        return () => {
            // Rời màn / unmount -> luôn tắt nhận tiền.
            sendBillAccept(false);
        };
    }, [method, conPhaiTra, loading, dangXuLy, sendBillAccept]);

    // Rời màn tiền mặt -> xoá trạng thái máy đọc tiền, lần vào sau lại bắt đầu từ "Đang kết nối…"
    // (backend đã đóng cổng, vào lại sẽ mở lại và emit bill_status mới).
    useEffect(() => {
        if (method !== 'cash') {
            setBillStatus(null);
            setBillPending(null);
        }
    }, [method]);

    // Dự phòng khi sự kiện bill_status KHÔNG tới (socket đang reconnect, hoặc request mở cổng bị mất):
    // ở màn tiền mặt mà 3 s vẫn chưa biết trạng thái -> hỏi thẳng /api/bill/status. Backend báo chưa
    // chạy -> gửi lại lệnh mở. Sau 4 lần (~12 s) vẫn chưa nối được -> báo lỗi để khách quay lại dùng mã
    // thay vì đứng chờ trước dòng "Đang kết nối…".
    useEffect(() => {
        if (method !== 'cash' || billStatus !== null) return undefined;
        let lan = 0;
        let huy = false;
        const timer = setInterval(async () => {
            lan += 1;
            try {
                const { data } = await axios.get(`${LOCAL_API_URL}/api/bill/status`, { timeout: 3000 });
                if (huy) return;
                if (data?.enabled === false) {
                    setBillStatus({ status: 'disabled', message: 'máy đọc tiền đang tắt trong cài đặt', port: data.port || '' });
                    return;
                }
                if (data?.status === 'connected') {
                    setBillStatus({ status: 'connected', message: '', port: data.port || '' });
                    return;
                }
                if (data?.status === 'stuck') {
                    // Driver máy đọc tiền kẹt (backend từ chối mở cổng để không rò worker in ảnh):
                    // báo lỗi ngay, gửi lại lệnh mở cũng vô ích.
                    setBillStatus({ status: 'error', message: 'máy đọc tiền treo — dùng mã hoặc rút cắm lại USB', port: data.port || '' });
                    return;
                }
                if (data?.running === false && billWantRef.current) sendBillAccept(true);
            } catch (e) {
                // backend không trả lời -> để lần sau
            }
            if (!huy && lan >= 4) {
                setBillStatus({ status: 'error', message: 'không kết nối được máy đọc tiền', port: '' });
            }
        }, 3000);
        return () => { huy = true; clearInterval(timer); };
    }, [method, billStatus, sendBillAccept]);

    // Đơn đang hiện không còn khớp số tiền phải chuyển (vd vừa nhận một khoản chuyển khác) -> bỏ hiện,
    // effect bên dưới hiện đơn đúng số tiền (đơn cũ vẫn được theo dõi).
    useEffect(() => {
        if (qrOrder && Number(qrOrder.amount) !== conLai) setQrOrder(null);
    }, [qrOrder, conLai]);

    useEffect(() => {
        if (method !== 'qr' || qrOrder || qrError || conLai <= 0) return undefined;

        // Khách Quay lại rồi chọn lại chuyển khoản: còn đơn CHƯA TRẢ đúng số tiền này -> hiện lại đơn đó
        // (khách có thể đã quét / đang chuyển theo nội dung cũ), không tạo đơn mới.
        const donCu = donQrRef.current.find((d) => !d.paid && d.amount === conLai);
        if (donCu) {
            setQrOrder(donCu.order);
            return undefined;
        }

        let cancelled = false;
        const requestId = qrRequestRef.current + 1;
        qrRequestRef.current = requestId;
        const soTien = conLai;

        const createOrder = async () => {
            setLoading(true);
            try {
                const res = await axios.post(`${CLOUD_API_URL}/api/sepay-orders`, {
                    amount: soTien,
                    session_id: sessionData?.sessionId || sessionData?.uuid || null,
                    device_id: getDeviceId(),
                });
                // Ghi nhận đơn kể cả khi khách đã rời màn QR: đơn có thật trên cloud, theo dõi cho chắc và
                // dùng lại được nếu khách chọn lại chuyển khoản cùng số tiền.
                if (res.data?.code) {
                    donQrRef.current.push({
                        code: res.data.code,
                        amount: Number(res.data.amount) || soTien,
                        paid: false,
                        order: res.data,
                    });
                }
                if (!cancelled && qrRequestRef.current === requestId) setQrOrder(res.data);
            } catch (error) {
                if (!cancelled && qrRequestRef.current === requestId) {
                    setQrError(error.response?.data?.error || 'Không thể tạo mã QR Tomato trên Vercel.');
                }
            } finally {
                if (!cancelled && qrRequestRef.current === requestId) setLoading(false);
            }
        };

        createOrder();
        return () => {
            cancelled = true;
            if (qrRequestRef.current === requestId) setLoading(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [method, qrOrder, qrError, conLai]);

    useEffect(() => {
        // Hỏi trạng thái MỌI đơn QR chưa trả của bước này qua API cloud mỗi 2.5 s — ở mọi màn, không chỉ
        // màn QR (khách đã chuyển rồi bấm Quay lại vẫn được tính). Trước 0.0.22 kiosk đọc THẲNG bảng
        // payments bằng khoá anon -> bảng phải cho đọc công khai. Realtime vốn hay không subscribe được
        // trên mạng booth (chặn WebSocket) nên poll mới là đường chính; socket 'sepay_payment_success'
        // bên trên vẫn giữ.
        let stopped = false;
        let dangHoi = false;
        const hoiTrangThai = async () => {
            if (dangHoi || dangXuLyRef.current) return;
            const choTra = donQrRef.current.filter((d) => !d.paid);
            if (!choTra.length) return;
            dangHoi = true;
            try {
                await Promise.all(choTra.map(async (don) => {
                    try {
                        const { data } = await axios.get(`${CLOUD_API_URL}/api/sepay-orders`, {
                            params: { code: don.code },
                            timeout: 8000,
                        });
                        if (!stopped && data?.status === 'paid') danhDauDaTra(don.code);
                    } catch (error) {
                        console.warn('QR payment status check failed:', error.message);
                    }
                }));
            } finally {
                dangHoi = false;
            }
        };

        const interval = setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            hoiTrangThai();
        }, 2500);
        return () => {
            stopped = true;
            clearInterval(interval);
        };
    }, [danhDauDaTra]);

    const methods = useMemo(() => [
        { id: 'cash', icon: Banknote, label: 'Tiền mặt' },
        { id: 'qr', icon: QrCode, label: 'Chuyển khoản' },
        { id: 'code', icon: Hash, label: voucher ? 'Mã đã áp dụng' : 'Nhập mã' }
    ], [voucher]);

    const appendCode = (value) => {
        if (code.length < 6) setCode(`${code}${value}`);
    };

    const selectMethod = (selectedMethod) => {
        if (selectedMethod === 'code' && voucher) return;
        // Đã nhét tiền mặt vẫn chuyển khoản được (0.0.23): đơn QR tạo theo PHẦN CÒN LẠI sau tiền mặt — máy
        // đọc tiền hỏng giữa chừng thì khách trả nốt bằng chuyển khoản, không chỉ bằng mã.
        setMethod(selectedMethod);
        if (selectedMethod !== 'qr') {
            setQrOrder(null);
            setQrError('');
        }
    };

    const goBack = () => {
        // Đang chốt thanh toán (mã đang được dùng / đơn đã trả) -> không cho rời: hẹn giờ sẽ sang bước chụp.
        if (dangXuLyRef.current) return;
        if (method === 'cash' && billPending?.status === 'dang_nhan') return;
        if (method) {
            qrRequestRef.current += 1;
            processingRef.current = false;
            setLoading(false);
            setMethod(null);
            // GIỮ tiền mặt + vết byte: khách quay lại để nhập mã thì số tiền đã nhét vẫn được tính.
            // Đơn QR thôi HIỆN nhưng vẫn được theo dõi (donQrRef), chọn lại chuyển khoản thì hiện lại.
            setQrOrder(null);
            setQrError('');
        } else if (cashInserted > 0 || donQrRef.current.some((d) => !d.paid)) {
            // Rời bước Thanh toán là mất tiền mặt đã nhét và thôi theo dõi đơn chuyển khoản -> hỏi lại.
            setXacNhanRoi(true);
        } else {
            prevStep();
        }
    };

    const renderSummary = () => (
        <div className="mb-10 w-full max-w-md rounded-3xl bg-white/90 p-8 text-center shadow-md">
            <h2 className="mb-2 text-5xl font-bold tracking-tight" style={{ color: secondaryTextColor }}>{formatVnd(price)}</h2>
            <div className="my-4 h-px w-full" style={{ backgroundColor: `${primaryTextColor}26` }} />
            <p className="text-xl font-bold" style={{ color: primaryTextColor }}>Số lượng: {printQuantity}</p>
            {(voucher || cashInserted > 0 || qrDaTra > 0) && (
                <div className="mt-5 space-y-2 rounded-2xl bg-[#F6E6C9]/45 p-4 text-left" style={{ color: secondaryTextColor }}>
                    {voucher && (
                        <div className="flex justify-between">
                            <span>Mã {voucher.code}</span>
                            <strong>-{formatVnd(voucherValue)}</strong>
                        </div>
                    )}
                    {cashInserted > 0 && (
                        <div className="flex justify-between">
                            <span>Tiền mặt đã nhận</span>
                            <strong>-{formatVnd(cashInserted)}</strong>
                        </div>
                    )}
                    {qrDaTra > 0 && (
                        <div className="flex justify-between">
                            <span>Chuyển khoản đã nhận</span>
                            <strong>-{formatVnd(qrDaTra)}</strong>
                        </div>
                    )}
                    <div className="flex justify-between text-lg">
                        <span>Còn lại</span>
                        <strong>{formatVnd(conLai)}</strong>
                    </div>
                </div>
            )}
        </div>
    );

    const renderMethodSelection = () => (
        <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center">
            <h2 className="mb-10 text-center text-5xl font-bold uppercase tracking-wide" style={{ color: primaryTextColor }}>
                Thanh toán
            </h2>

            {renderSummary()}

            <div className="mb-10 flex w-full max-w-lg items-center gap-4 opacity-80">
                <div className="h-px flex-1 rounded-full" style={{ backgroundColor: `${primaryTextColor}40` }} />
                <span className="whitespace-nowrap text-lg font-semibold italic" style={{ color: primaryTextColor }}>
                    {remainingAmount <= 0 ? 'Mã đã thanh toán đủ' : (cashInserted > 0 || qrDaTra > 0) ? 'Trả nốt phần còn lại' : 'Chọn phương thức'}
                </span>
                <div className="h-px flex-1 rounded-full" style={{ backgroundColor: `${primaryTextColor}40` }} />
            </div>

            <div className="grid w-full max-w-3xl grid-cols-3 gap-6">
                {methods.map((item) => {
                    const Icon = item.icon;
                    const disabled = item.id === 'code' && Boolean(voucher);
                    return (
                        <button
                            type="button"
                            key={item.id}
                            onClick={() => selectMethod(item.id)}
                            disabled={disabled}
                            className="flex aspect-square flex-col items-center justify-center gap-4 rounded-3xl border border-[#F6E6C9] bg-white/90 p-6 shadow-md disabled:opacity-60"
                        >
                            <div className="rounded-full bg-[#F6E6C9]/55 p-4">
                                <Icon size={42} style={{ color: primaryTextColor }} />
                            </div>
                            <span className="text-xl font-bold" style={{ color: primaryTextColor }}>{item.label}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );

    const renderCash = () => (
        <div className="flex flex-col items-center gap-6">
            <Banknote size={80} style={{ color: primaryTextColor }} />
            <h3 className="text-3xl font-bold" style={{ color: primaryTextColor }}>Đưa tiền vào khe bên dưới</h3>
            {voucher && <p className="text-lg font-bold" style={{ color: primaryTextColor }}>Mã đã trừ {formatVnd(voucherValue)}</p>}
            {qrDaTra > 0 && <p className="text-lg font-bold" style={{ color: primaryTextColor }}>Đã chuyển khoản {formatVnd(qrDaTra)}</p>}
            <div className="h-6 w-full overflow-hidden rounded-full bg-[#F6E6C9]">
                <div
                    className="h-full bg-[#C8A47A]"
                    style={{ width: `${Math.min((cashInserted / cashProgressTotal) * 100, 100)}%` }}
                />
            </div>
            <p className="text-2xl font-bold" style={{ color: primaryTextColor }}>
                {formatVnd(cashInserted)} / {formatVnd(mucTienMat)}
            </p>
            {billPending?.status === 'dang_nhan' ? (
                <p className="flex items-center gap-2 text-lg font-semibold" style={{ color: primaryTextColor }}>
                    <Loader2 size={22} className="animate-spin" />
                    Đang nhận tờ {formatVnd(billPending.amount)}… vui lòng chờ
                </p>
            ) : billPending?.status === 'tra_lai' ? (
                <p className="max-w-md text-center text-lg font-semibold text-red-700">
                    Máy trả lại tờ {formatVnd(billPending.amount)} — vui lòng nhét lại tờ tiền
                </p>
            ) : billStatus?.status === 'error' || billStatus?.status === 'disabled' ? (
                <div className="max-w-md text-center">
                    <p className="text-base font-semibold text-red-700">
                        {billStatus.status === 'disabled' ? 'Máy đọc tiền đang tắt' : 'Máy đọc tiền lỗi'} — bấm Quay lại và dùng mã
                    </p>
                    {billStatus.message ? (
                        <p className="mt-1 break-words text-xs text-red-700 opacity-70">{billStatus.message}</p>
                    ) : null}
                </div>
            ) : (
                <p className="text-base font-semibold opacity-70" style={{ color: secondaryTextColor }}>
                    {billStatus?.status === 'connected' ? 'Máy đọc tiền sẵn sàng' : 'Đang kết nối máy đọc tiền…'}
                </p>
            )}
        </div>
    );

    const renderQr = () => (
        <div className="flex flex-col items-center gap-5">
            <QrCode size={72} style={{ color: primaryTextColor }} />
            <h3 className="text-3xl font-bold" style={{ color: primaryTextColor }}>Quét mã QR</h3>
            {(voucher || cashInserted > 0 || qrDaTra > 0) && (
                <p className="text-lg font-bold" style={{ color: primaryTextColor }}>Cần chuyển thêm {formatVnd(conLai)}</p>
            )}

            {qrError ? (
                <div className="max-w-md rounded-2xl border border-red-200 bg-red-50 p-5 text-center text-red-700">
                    <p className="font-bold">Chưa tạo được QR Tomato</p>
                    <p className="mt-2 text-sm">{qrError}</p>
                </div>
            ) : qrOrder ? (
                <>
                    <img
                        src={qrOrder.qr_url}
                        alt="QR thanh toán Tomato"
                        className="h-64 w-64 rounded-2xl border-2 border-[#F6E6C9] bg-white p-3 shadow-inner"
                    />
                    <div className="w-full max-w-md rounded-2xl bg-[#F6E6C9]/35 p-4 text-left" style={{ color: secondaryTextColor }}>
                        <div className="flex justify-between gap-4">
                            <span>Ngân hàng</span>
                            <strong>{qrOrder.bank}</strong>
                        </div>
                        <div className="mt-2 flex justify-between gap-4">
                            <span>Số tài khoản</span>
                            <strong>{qrOrder.account_number}</strong>
                        </div>
                        <div className="mt-2 flex justify-between gap-4">
                            <span>Nội dung</span>
                            <strong>{qrOrder.content}</strong>
                        </div>
                    </div>
                    <p className="text-lg font-bold" style={{ color: primaryTextColor }}>Đang chờ Tomato xác nhận tự động...</p>
                </>
            ) : (
                <div className="flex h-64 w-64 items-center justify-center rounded-2xl border-2 border-[#F6E6C9] bg-white">
                    <Loader2 size={44} className="animate-spin" style={{ color: primaryTextColor }} />
                </div>
            )}
        </div>
    );

    const renderCode = () => (
        <div className="flex flex-col items-center gap-6">
            <Hash size={80} style={{ color: primaryTextColor }} />
            <h3 className="text-3xl font-bold" style={{ color: primaryTextColor }}>Nhập mã</h3>
            <p className="max-w-md text-center text-lg font-semibold" style={{ color: primaryTextColor }}>
                Mã có thể dùng như voucher. Nếu mã thấp hơn tổng tiền, khách thanh toán thêm phần còn lại.
            </p>

            <div className="mb-4 flex gap-2">
                {Array.from({ length: 6 }).map((_, index) => (
                    <div
                        key={index}
                        className="flex h-16 w-12 items-center justify-center rounded-xl border-2 border-[#F6E6C9] bg-white text-2xl font-bold"
                        style={{ color: primaryTextColor }}
                    >
                        {code[index] || ''}
                    </div>
                ))}
            </div>

            <div className="grid w-full max-w-xs grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <button
                        type="button"
                        key={num}
                        onClick={() => appendCode(num)}
                        className="rounded-xl border-2 border-[#F6E6C9] bg-white py-4 text-2xl font-bold"
                        style={{ color: primaryTextColor }}
                    >
                        {num}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={() => setCode('')}
                    className="rounded-xl border-2 border-red-300 bg-red-100 py-4 text-lg font-bold text-red-600"
                >
                    Xóa
                </button>
                <button
                    type="button"
                    onClick={() => appendCode(0)}
                    className="rounded-xl border-2 border-[#F6E6C9] bg-white py-4 text-2xl font-bold"
                    style={{ color: primaryTextColor }}
                >
                    0
                </button>
                <button
                    type="button"
                    onClick={() => setCode(code.slice(0, -1))}
                    className="rounded-xl border-2 border-yellow-300 bg-yellow-100 py-4 text-lg font-bold text-yellow-700"
                >
                    Lùi
                </button>
            </div>

            <button
                type="button"
                onClick={applyCode}
                disabled={loading || code.length !== 6}
                className="mt-4 rounded-full bg-[#987351] px-10 py-3 text-lg font-black text-white shadow-lg transition-colors hover:bg-[#7B5E43] active:scale-95 disabled:bg-[#C9B49A] disabled:opacity-70"
            >
                Áp dụng mã
            </button>
        </div>
    );

    const renderContent = () => {
        if (!method) return renderMethodSelection();

        return (
            <div className="relative w-full max-w-2xl rounded-3xl bg-white/90 p-12 text-center shadow-md">
                {method === 'cash' && renderCash()}
                {method === 'qr' && renderQr()}
                {method === 'code' && renderCode()}
            </div>
        );
    };

    // Màn "Đang xử lý": chốt thanh toán (mọi phương thức) hoặc đang kiểm mã / tạo đơn tiền mặt. Vẽ TRONG
    // khung chính chứ không return sớm: return sớm gỡ <img> live view ẩn bên dưới mà không ngắt luồng
    // MJPEG (mỗi lần nhập mã sai lại mở thêm một kết nối tới máy ảnh -> chạm trần 6 kết nối của Chrome).
    const hienXuLy = dangXuLy || (loading && method && method !== 'qr');

    return (
        <div
            className="relative flex min-h-full w-full flex-col items-center justify-center bg-[#FFF8E7] bg-cover bg-center p-8 font-serif"
            style={{
                backgroundImage: hienXuLy
                    ? (configs?.['bg_payment-wait'] ? `url('${configs['bg_payment-wait']}')` : 'none')
                    : (configs?.['bg_payment'] ? `url('${configs['bg_payment']}')` : 'none'),
            }}
        >
            {/* Pre-warm live view Canon (EVF) ngay từ bước thanh toán: mở sẵn luồng MJPEG để khi
                vào bước chụp live view đã ra hình -> video motion ảnh ĐẦU không bị trống. Ẩn nhưng
                vẫn stream. Chỉ áp dụng canon mode. */}
            {configs?.camera_mode === 'canon' && (
                <img
                    ref={liveImgRef}
                    src="http://localhost:5001/liveview"
                    alt=""
                    aria-hidden="true"
                    style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', left: 0, top: 0 }}
                />
            )}
            {hienXuLy ? (
                <div className="flex flex-col items-center justify-center gap-4">
                    <Loader2 size={64} className="animate-spin" style={{ color: primaryTextColor }} />
                    <p className="text-xl font-bold" style={{ color: primaryTextColor }}>Đang xử lý thanh toán...</p>
                </div>
            ) : (
            <>
            <button
                type="button"
                onClick={goBack}
                disabled={method === 'cash' && billPending?.status === 'dang_nhan'}
                className="absolute left-6 top-6 z-10 flex items-center gap-2 rounded-full bg-white/80 px-6 py-3 font-bold shadow-sm backdrop-blur disabled:opacity-40"
                style={{ color: primaryTextColor }}
            >
                <ArrowLeft size={24} />
                <span>Quay lại</span>
            </button>

            <div className="mx-auto flex w-full max-w-6xl flex-col items-center">
                {renderContent()}
            </div>

            {xacNhanRoi && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="mx-4 w-full max-w-md rounded-3xl bg-white/95 p-8 text-center shadow-2xl">
                        <h3 className="mb-4 text-2xl font-bold" style={{ color: secondaryTextColor }}>
                            {cashInserted > 0 ? `Bạn đã nhét ${formatVnd(cashInserted)}` : 'Bạn đã mở mã chuyển khoản'}
                        </h3>
                        <p className="mb-8 text-lg" style={{ color: primaryTextColor }}>
                            {cashInserted > 0
                                ? 'Quay lại bây giờ sẽ huỷ số tiền này. Bạn có thể nhét tiếp, chuyển khoản hoặc nhập mã để trả phần còn lại.'
                                : 'Nếu bạn đã chuyển khoản, hãy ở lại chờ xác nhận. Quay lại bây giờ thì khoản chuyển sẽ không được tính cho lượt chụp này.'}
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => setXacNhanRoi(false)}
                                className="flex-1 rounded-full bg-[#987351] px-6 py-3 font-bold text-white shadow-lg"
                            >
                                Ở lại thanh toán
                            </button>
                            <button
                                type="button"
                                onClick={() => { setXacNhanRoi(false); prevStep(); }}
                                className="flex-1 rounded-full bg-gray-200 px-6 py-3 font-bold text-gray-700"
                            >
                                Vẫn quay lại
                            </button>
                        </div>
                    </div>
                </div>
            )}
            </>
            )}

            {errorModal.show && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="mx-4 w-full max-w-md rounded-3xl border border-red-200 bg-white/95 p-8 shadow-2xl">
                        <div className="text-center">
                            <div className="mb-4 text-6xl text-red-500">!</div>
                            <h3 className="mb-4 text-2xl font-bold" style={{ color: secondaryTextColor }}>Lỗi thanh toán</h3>
                            <p className="mb-8 text-lg" style={{ color: primaryTextColor }}>{errorModal.message}</p>
                            <div className="flex flex-wrap justify-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        // Mở lại khoá để lượt thanh toán sau (thử lại) được phép chạy.
                                        processingRef.current = false;
                                        setErrorModal({ show: false, message: '' });
                                        setCode('');
                                        // Mã (+ tiền mặt / chuyển khoản) đủ giá mà lần dùng mã lỗi -> "Thử lại" dùng
                                        // mã lại ngay (trước 0.0.22 mã đủ giá + Đóng thì không gì chạy lại).
                                        if (errorModal.boMa && voucher
                                            && voucher.value + cashInserted + qrDaTra >= price) {
                                            handlePaymentSuccess(cashInserted > 0 ? 'cash' : 'code');
                                        }
                                    }}
                                    className="rounded-full bg-[#D5B895] px-8 py-3 font-bold text-white shadow-lg"
                                >
                                    {errorModal.boMa && voucher ? 'Thử lại' : 'Đóng'}
                                </button>
                                {errorModal.boMa && voucher && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            // Bỏ mã không dùng được: tiền mặt / chuyển khoản đã nhận vẫn giữ, khách
                                            // trả phần còn lại bằng tiền mặt / chuyển khoản / mã khác. (Trước 0.0.23
                                            // ở màn QR không có nút này: mã + QR mà mã hỏng thì kẹt ở lỗi.)
                                            processingRef.current = false;
                                            setVoucher(null);
                                            setMethod(null);
                                            setErrorModal({ show: false, message: '' });
                                            setCode('');
                                        }}
                                        className="rounded-full bg-gray-200 px-8 py-3 font-bold text-gray-700"
                                    >
                                        Bỏ mã, trả cách khác
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Payment;
