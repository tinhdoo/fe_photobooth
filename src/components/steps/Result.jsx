import { useEffect, useRef, useState } from 'react';
import QRCodeStyling from 'qr-code-styling';
import { QrCode, Printer, Loader2, CheckCircle2, AlertTriangle, ArrowLeft } from 'lucide-react';
import { useWorkflow, themViecNen } from '../../context/WorkflowContext';
import Payment from './Payment';
import { luaChonInThem, guiLenhInThem, ghiLuotInThem } from '../../utils/inThem';

import { CLOUD_API_URL } from '../../config/api';

const AUTO_HOME_MS = 5 * 60 * 1000; // 5 phút không ai chạm
const TRAN_MS = 15 * 60 * 1000; // trần tuyệt đối ở màn QR / màn lỗi (màn cảm ứng chạm ma vẫn về trang chủ)
const formatVnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')} VNĐ`;
const taoMa = () => (window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);

const Result = () => {
    const { resetSession, sessionData, configs, isEventMode, isIdleHeld } = useWorkflow();
    const finalImage = sessionData.finalImage;
    const sessionId = sessionData.sessionId;
    const logoUrl = configs?.logo_main || '/logo_tomato.png';
    const primaryTextColor = configs?.brand_text_primary || '#7B5E43';
    const secondaryTextColor = configs?.brand_text_secondary || '#5E6B78';
    const [viewUrl, setViewUrl] = useState('');
    const qrRef = useRef(null);

    // IN THÊM: null (màn QR) | {buoc:'chon'} | {buoc:'tra', lua, maLan} | {buoc:'in', lua, thanhToan, maLan, loi?}.
    // maLan sinh lúc VÀO màn trả tiền: đơn chuyển khoản mang mã này (không mang mã album gốc), nên Doanh thu ghép đơn
    // vào đúng lần in thêm, hoặc hiện thành dòng QR riêng nếu bản ghi in thêm chưa lên — không lẫn vào lượt gốc.
    // Chỉ khi lượt này đã trả tiền và đã in (chế độ Sự kiện không thu tiền -> ẩn, nhân viên in thêm ở bảng nhân viên).
    const [inThem, setInThem] = useState(null);
    const [daInThem, setDaInThem] = useState(null); // số tờ vừa in thêm -> báo trên màn QR
    const coInThem = !isEventMode && sessionData.paymentStatus === 'completed' && !!sessionData.printedSessionId;
    const luaChon = luaChonInThem(configs, sessionData.layout, sessionData.source === 'upload');
    const [chon, setChon] = useState(0);
    const inThemRef = useRef(inThem);
    inThemRef.current = inThem;

    useEffect(() => {
        if (viewUrl && qrRef.current) {
            qrRef.current.innerHTML = '';
            const qrCode = new QRCodeStyling({
                width: 200,
                height: 200,
                data: viewUrl,
                margin: 10,
                qrOptions: { errorCorrectionLevel: 'L' },
                dotsOptions: { color: secondaryTextColor, type: 'square' },
                cornersSquareOptions: { type: 'extra-rounded', color: primaryTextColor },
                cornersDotOptions: { type: 'dot', color: '#C8A47A' }
            });
            qrCode.append(qrRef.current);
        }
        // inThem: quay lại màn QR thì khung QR được dựng lại -> vẽ lại mã.
    }, [viewUrl, primaryTextColor, secondaryTextColor, inThem]);

    useEffect(() => {
        const fetchViewUrl = async () => {
            if (!sessionId) {
                setViewUrl(finalImage);
                return;
            }
            const albumBaseUrl = CLOUD_API_URL || window.location.origin;
            setViewUrl(`${albumBaseUrl}/album/${sessionId}`);
        };
        fetchViewUrl();
    }, [sessionId, finalImage]);

    // Tự VỀ TRANG CHỦ khi 5 phút không ai chạm (khách quét xong bỏ đi mà KHÔNG bấm nút) -> giải phóng booth cho khách
    // sau + để máy ảnh về nghỉ. KHÔNG về khi đang gửi lệnh in thêm, hoặc khách đang trả tiền in thêm dở (đã nhét tiền,
    // đơn chuyển khoản còn hạn — Payment báo qua setIdleHold). Màn lỗi in thêm thì VẪN về (khách bỏ đi thì booth không
    // đứng mãi ở màn lỗi; tiền đã ghi Doanh thu). Ở màn QR / màn lỗi còn trần 15 phút kể cả có người chạm.
    // Deps [] (mount 1 lần): resetSession đổi tham chiếu mỗi giây (đồng hồ phiên); closure cũ vẫn đúng vì nó đọc
    // pendingMediaUpload ở cấp module.
    useEffect(() => {
        let lanCuoi = Date.now();
        let tuLuc = Date.now();
        const cham = () => { lanCuoi = Date.now(); };
        const SU_KIEN = ['pointerdown', 'touchstart', 'keydown'];
        SU_KIEN.forEach((e) => window.addEventListener(e, cham, { capture: true, passive: true }));
        let daVe = false;
        const t = setInterval(() => {
            const dang = inThemRef.current;
            const giu = (dang?.buoc === 'in' && !dang.loi) || (dang?.buoc === 'tra' && isIdleHeld());
            if (giu) lanCuoi = Date.now();
            // Trần chỉ tính khi khách không ở giữa luồng in thêm (chọn / trả tiền / đang in).
            if (dang && !dang.loi) tuLuc = Date.now();
            if (!daVe && (Date.now() - lanCuoi > AUTO_HOME_MS || Date.now() - tuLuc > TRAN_MS)) {
                daVe = true;
                resetSession();
            }
        }, 1000);
        return () => {
            clearInterval(t);
            SU_KIEN.forEach((e) => window.removeEventListener(e, cham, { capture: true }));
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Trả tiền xong -> in ngay; ghi doanh thu chạy nền (thử lại vài lần, Về trang chủ chờ nó xong).
    const dangInRef = useRef(false); // chặn bấm Thử lại hai lần liền
    const batDauIn = async (trang) => {
        if (dangInRef.current) return;
        dangInRef.current = true;
        setInThem({ ...trang, buoc: 'in', loi: null });
        try {
            await guiLenhInThem({ maInGoc: sessionData.printedSessionId, soTo: trang.lua.soTo, maLan: trang.maLan });
        } catch (e) {
            const msg = e.response?.data?.error || e.message || 'không rõ';
            setInThem({ ...trang, buoc: 'in', loi: msg });
            return;
        } finally {
            dangInRef.current = false;
        }
        setDaInThem(trang.lua.soLuong);
        setInThem(null);
    };

    const traXong = (thanhToan) => {
        const dang = inThemRef.current;
        if (!dang?.lua || !dang.maLan) return;
        const trang = { lua: dang.lua, thanhToan, maLan: dang.maLan };
        // Ghi doanh thu NGAY khi đã nhận tiền (kể cả nếu máy in lỗi): tiền khách trả phải có trên trang Doanh thu.
        themViecNen(ghiLuotInThem({
            maLan: trang.maLan,
            maAlbum: sessionId,
            sessionData,
            thanhToan,
            lua: trang.lua,
        }).catch((e) => console.error('[Result] ghi doanh thu in thêm lỗi (còn trong kho chờ, gửi bù lần sau):', e)));
        batDauIn(trang);
    };

    const nen = { backgroundImage: configs?.['bg_qr-photo'] ? `url('${configs['bg_qr-photo']}')` : 'none' };

    if (inThem?.buoc === 'tra') {
        return (
            <Payment
                inThem={{
                    soTien: inThem.lua.soTien,
                    soLuong: inThem.lua.soLuong,
                    maLan: inThem.maLan,
                    onXong: traXong,
                    onQuayLai: () => setInThem({ buoc: 'chon' }),
                }}
            />
        );
    }

    if (inThem?.buoc === 'chon') {
        const lua = luaChon[chon] || luaChon[0];
        return (
            <div className="relative flex h-full w-full flex-col items-center justify-center bg-[#FFF8E7] bg-cover bg-center p-8 font-serif" style={nen}>
                <button
                    type="button"
                    onClick={() => setInThem(null)}
                    className="absolute left-6 top-6 z-10 flex items-center gap-2 rounded-full bg-white/80 px-6 py-3 font-bold shadow-sm backdrop-blur active:scale-95"
                    style={{ color: primaryTextColor }}
                >
                    <ArrowLeft size={24} />
                    <span>Quay lại</span>
                </button>
                <h2 className="mb-12 text-center text-5xl font-bold uppercase tracking-wide" style={{ color: primaryTextColor }}>
                    In thêm ảnh
                </h2>
                <div className="mb-12 flex gap-6">
                    {luaChon.map((o, i) => (
                        <button
                            type="button"
                            key={o.soTo}
                            onClick={() => setChon(i)}
                            className={`flex h-32 w-32 items-center justify-center rounded-3xl text-5xl font-bold shadow-lg transition-all ${chon === i ? 'scale-110 bg-[#D5B895] text-white' : 'bg-[#F6E6C9]'}`}
                            style={chon === i ? undefined : { color: primaryTextColor }}
                        >
                            {o.soLuong}
                        </button>
                    ))}
                </div>
                <div className="mb-8 rounded-3xl bg-white/90 px-10 py-6 text-center shadow-md">
                    <p className="text-2xl font-bold" style={{ color: primaryTextColor }}>In thêm {lua.soLuong} bản</p>
                    <p className="mt-2 text-3xl font-bold" style={{ color: secondaryTextColor }}>{formatVnd(lua.soTien)}</p>
                </div>
                <button
                    type="button"
                    onClick={() => setInThem({ buoc: 'tra', lua, maLan: taoMa() })}
                    className="rounded-full bg-[#D5B895] px-12 py-4 text-xl font-bold text-white shadow-lg active:scale-95"
                >
                    Thanh toán
                </button>
            </div>
        );
    }

    if (inThem?.buoc === 'in') {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center bg-[#FFF8E7] bg-cover bg-center p-8 font-serif" style={nen}>
                <div className="flex w-full max-w-xl flex-col items-center gap-5 rounded-3xl bg-white/90 p-12 text-center shadow-md">
                    {inThem.loi ? (
                        <>
                            <AlertTriangle size={56} className="text-amber-500" />
                            <h2 className="text-3xl font-bold" style={{ color: primaryTextColor }}>Chưa in thêm được</h2>
                            <p className="text-lg" style={{ color: secondaryTextColor }}>
                                Bạn đã thanh toán {formatVnd(inThem.thanhToan.amount)}. Máy in báo: {inThem.loi}
                                <br />Bấm Thử lại, hoặc nhờ nhân viên hỗ trợ.
                            </p>
                            <div className="flex w-full gap-3">
                                <button
                                    type="button"
                                    onClick={() => batDauIn(inThem)}
                                    className="flex-1 rounded-xl bg-[#D5B895] py-4 text-xl font-bold text-white shadow-lg active:scale-95"
                                >
                                    Thử lại
                                </button>
                                <button
                                    type="button"
                                    onClick={resetSession}
                                    className="flex-1 rounded-xl border-2 border-[#D5B895] bg-white py-4 text-xl font-bold active:scale-95"
                                    style={{ color: primaryTextColor }}
                                >
                                    Về trang chủ
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <Loader2 size={56} className="animate-spin" style={{ color: primaryTextColor }} />
                            <p className="text-2xl font-bold" style={{ color: primaryTextColor }}>Đang in thêm {inThem.lua.soLuong} bản…</p>
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div
            className="flex h-full w-full flex-col items-center justify-center bg-[#FFF8E7] bg-cover bg-center p-8 font-serif"
            style={nen}
        >
            <div className="flex w-full max-w-2xl flex-col items-center rounded-3xl bg-white/90 p-12 text-center shadow-md">
                <div className="mb-5 flex justify-center">
                    <img
                        src={logoUrl}
                        alt="Tomato Photobooth"
                        className="h-20 w-20 rounded-full object-contain"
                        onError={(e) => {
                            // logo_main có thể là URL không truy cập được trên máy khác -> fallback logo mặc định
                            if (!e.currentTarget.src.endsWith('/logo_tomato.png')) {
                                e.currentTarget.src = '/logo_tomato.png';
                            }
                        }}
                    />
                </div>

                <h2 className="mb-3 text-center text-5xl font-bold uppercase tracking-wide" style={{ color: primaryTextColor }}>
                    Ảnh đã sẵn sàng
                </h2>
                <p className="mb-8 max-w-xl text-balance text-center text-xl font-semibold leading-relaxed" style={{ color: primaryTextColor }}>
                    Quét QR để mang những khoảnh khắc đáng yêu này về nhé ❤️
                </p>

                <div className="mb-4 rounded-2xl border border-[#F6E6C9] bg-white p-4 shadow-inner">
                    {viewUrl ? (
                        <div ref={qrRef} />
                    ) : (
                        <div className="flex h-[200px] w-[200px] items-center justify-center rounded bg-[#F6E6C9]/35" style={{ color: `${primaryTextColor}80` }}>
                            <QrCode size={64} />
                        </div>
                    )}
                </div>

                {!viewUrl && (
                    <p className="mb-8 text-sm italic text-red-400">Ảnh chưa sẵn sàng</p>
                )}

                {daInThem && (
                    <p className="mb-4 flex items-center gap-2 text-lg font-bold text-green-700">
                        <CheckCircle2 size={22} /> Đã in thêm {daInThem} bản
                    </p>
                )}

                {coInThem && (
                    <button
                        type="button"
                        onClick={() => { setChon(0); setInThem({ buoc: 'chon' }); }}
                        className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#D5B895] bg-white py-4 text-xl font-bold shadow-sm transition-none active:scale-95"
                        style={{ color: primaryTextColor }}
                    >
                        <Printer size={24} /> In thêm ảnh
                    </button>
                )}

                <button
                    type="button"
                    onClick={resetSession}
                    className="w-full rounded-xl bg-[#D5B895] py-4 text-xl font-bold text-white shadow-lg transition-none active:scale-95"
                >
                    Về trang chủ
                </button>
            </div>
        </div>
    );
};

export default Result;
