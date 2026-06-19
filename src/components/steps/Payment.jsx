import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useRef } from 'react';
import { ArrowLeft, Banknote, Hash, Loader2, QrCode } from 'lucide-react';
import { io } from 'socket.io-client';
import { useWorkflow } from '../../context/WorkflowContext';
import { getDeviceId } from '../../utils/deviceId';
import { isSupabaseBrowserConfigured, supabase } from '../../services/supabaseClient';

const formatVnd = (value) => `${Math.max(value, 0).toLocaleString('vi-VN')} VNĐ`;
const CLOUD_API_URL = import.meta.env.VITE_CLOUD_API_URL
    || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'https://tomatophotobooth.vercel.app'
        : '');

const Payment = () => {
    const { nextStep, prevStep, sessionData, updateSessionData, configs } = useWorkflow();
    const [method, setMethod] = useState(null);
    const [loading, setLoading] = useState(false);
    const [cashInserted, setCashInserted] = useState(0);
    const [code, setCode] = useState('');
    const [voucher, setVoucher] = useState(null);
    const [qrOrder, setQrOrder] = useState(null);
    const [qrError, setQrError] = useState('');
    const [errorModal, setErrorModal] = useState({ show: false, message: '' });
    const qrRequestRef = useRef(0);

    const price = sessionData.printPrice || 60000;
    const printQuantity = sessionData.printQuantity || 1;
    const voucherValue = Math.min(voucher?.value || 0, price);
    const remainingAmount = Math.max(price - voucherValue, 0);
    const cashProgressTotal = remainingAmount || price;
    const primaryTextColor = configs?.brand_text_primary || '#7B5E43';
    const secondaryTextColor = configs?.brand_text_secondary || '#5E6B78';

    const finalPaymentMethod = useCallback((baseMethod, activeVoucher = voucher) => {
        if (!activeVoucher) return baseMethod;
        return baseMethod === 'code' ? 'code' : `code+${baseMethod}`;
    }, [voucher]);

    const handlePaymentSuccess = useCallback((baseMethod, extraData = {}) => {
        const activeVoucher = extraData.voucher || voucher;
        const activeVoucherValue = Math.min(activeVoucher?.value || 0, price);
        setLoading(true);
        setTimeout(async () => {
            if (activeVoucher?.id && !activeVoucher.used) {
                try {
                    await axios.post(`${CLOUD_API_URL}/api/codes`, { action: 'use', id: activeVoucher.id });
                    setVoucher((prev) => prev?.id === activeVoucher.id ? { ...prev, used: true } : prev);
                } catch (error) {
                    setLoading(false);
                    setErrorModal({
                        show: true,
                        message: error.response?.data?.message || 'Không thể sử dụng mã thanh toán. Vui lòng thử lại.'
                    });
                    return;
                }
            }

            setLoading(false);
            updateSessionData('paymentMethod', finalPaymentMethod(baseMethod || method, activeVoucher));
            updateSessionData('paymentStatus', 'completed');
            updateSessionData('paymentTotal', price);
            updateSessionData('paymentPaidAmount', price);
            if (activeVoucher) {
                updateSessionData('paymentCode', activeVoucher.code);
                updateSessionData('paymentCodeValue', activeVoucher.value);
                updateSessionData('paymentCodeApplied', activeVoucherValue);
            }
            if (cashInserted > 0) updateSessionData('cashInserted', cashInserted);
            if (extraData.orderCode) updateSessionData('sepayOrderCode', extraData.orderCode);
            nextStep();
        }, 500);
    }, [cashInserted, finalPaymentMethod, method, nextStep, price, updateSessionData, voucher]);

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
            setVoucher(appliedVoucher);
            updateSessionData('paymentCode', code);
            updateSessionData('paymentCodeValue', res.data.value);
            updateSessionData('paymentCodeApplied', Math.min(res.data.value, price));
            setCode('');
            setMethod(null);
            setCashInserted(0);
            setQrOrder(null);
            setQrError('');

            if (res.data.value >= price) {
                handlePaymentSuccess('code', { voucher: appliedVoucher });
            }
        } catch (error) {
            setErrorModal({
                show: true,
                message: error.response?.data?.message || 'Không thể xử lý mã thanh toán. Vui lòng thử lại.'
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const socket = io('/', {
            transports: ['polling'],
            reconnectionAttempts: 5,
            auth: { deviceId: getDeviceId() }
        });

        socket.on('connect_error', (err) => {
            console.warn('Socket connection error:', err.message);
        });

        socket.on('money_inserted', (data) => {
            if (!method || method === 'cash') {
                if (method !== 'cash') setMethod('cash');
                setCashInserted((prev) => prev + data.amount);
            }
        });

        socket.on('sepay_payment_success', (data) => {
            if (data.order_code && data.order_code === qrOrder?.code) {
                handlePaymentSuccess('qr', { orderCode: data.order_code });
            }
        });

        return () => socket.disconnect();
    }, [handlePaymentSuccess, method, qrOrder?.code]);

    useEffect(() => {
        if (method === 'cash' && remainingAmount > 0 && cashInserted >= remainingAmount) {
            handlePaymentSuccess('cash');
        }
    }, [cashInserted, handlePaymentSuccess, method, remainingAmount]);

    useEffect(() => {
        if (method !== 'qr' || qrOrder || qrError || remainingAmount <= 0) return;

        let cancelled = false;
        const requestId = qrRequestRef.current + 1;
        qrRequestRef.current = requestId;

        const createOrder = async () => {
            setLoading(true);
            try {
                const res = await axios.post(`${CLOUD_API_URL}/api/sepay-orders`, {
                    amount: remainingAmount,
                    session_id: sessionData?.sessionId || sessionData?.uuid || null,
                    device_id: getDeviceId(),
                });
                if (!cancelled && qrRequestRef.current === requestId) setQrOrder(res.data);
            } catch (error) {
                if (!cancelled && qrRequestRef.current === requestId) {
                    setQrError(error.response?.data?.error || 'Không thể tạo mã QR Sepay trên Vercel.');
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
    }, [method, qrOrder, qrError, remainingAmount]);

    useEffect(() => {
        if (method !== 'qr' || !qrOrder?.code) return undefined;

        if (!isSupabaseBrowserConfigured || !supabase) {
            setQrError('Chưa cấu hình VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY cho kiosk.');
            return undefined;
        }

        let stopped = false;
        let realtimeReady = false;
        let channel = null;

        const checkStatus = async () => {
            try {
                const { data, error } = await supabase
                    .from('payments')
                    .select('status')
                    .eq('code', qrOrder.code)
                    .single();

                if (error) throw error;
                if (!stopped && data?.status === 'paid') {
                    handlePaymentSuccess('qr', { orderCode: qrOrder.code });
                }
            } catch (error) {
                console.warn('Supabase payment status check failed:', error.message);
            }
        };

        channel = supabase
            .channel(`payment-status-${qrOrder.code}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'payments',
                    filter: `code=eq.${qrOrder.code}`
                },
                (payload) => {
                    if (!stopped && payload.new?.status === 'paid') {
                        handlePaymentSuccess('qr', { orderCode: qrOrder.code });
                    }
                }
            )
            .subscribe((status) => {
                realtimeReady = status === 'SUBSCRIBED';
            });

        checkStatus();
        const interval = setInterval(() => {
            if (realtimeReady || document.visibilityState !== 'visible') return;
            checkStatus();
        }, 10000);
        return () => {
            stopped = true;
            clearInterval(interval);
            if (channel && supabase) supabase.removeChannel(channel);
        };
    }, [handlePaymentSuccess, method, qrOrder?.code]);

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
        setMethod(selectedMethod);
        if (selectedMethod !== 'qr') {
            setQrOrder(null);
            setQrError('');
        }
    };

    const goBack = () => {
        if (method) {
            qrRequestRef.current += 1;
            setLoading(false);
            setMethod(null);
            setCashInserted(0);
            setQrOrder(null);
            setQrError('');
        } else {
            prevStep();
        }
    };

    const renderSummary = () => (
        <div className="mb-10 w-full max-w-md rounded-3xl bg-white/90 p-8 text-center shadow-md">
            <h2 className="mb-2 text-5xl font-bold tracking-tight" style={{ color: secondaryTextColor }}>{formatVnd(price)}</h2>
            <div className="my-4 h-px w-full" style={{ backgroundColor: `${primaryTextColor}26` }} />
            <p className="text-xl font-bold" style={{ color: primaryTextColor }}>Số lượng: {printQuantity}</p>
            {voucher && (
                <div className="mt-5 rounded-2xl bg-[#F6E6C9]/45 p-4 text-left" style={{ color: secondaryTextColor }}>
                    <div className="flex justify-between">
                        <span>Mã {voucher.code}</span>
                        <strong>-{formatVnd(voucherValue)}</strong>
                    </div>
                    <div className="mt-2 flex justify-between text-lg">
                        <span>Còn lại</span>
                        <strong>{formatVnd(remainingAmount)}</strong>
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
                    {remainingAmount > 0 ? 'Chọn phương thức' : 'Mã đã thanh toán đủ'}
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
            <div className="h-6 w-full overflow-hidden rounded-full bg-[#F6E6C9]">
                <div
                    className="h-full bg-[#C8A47A]"
                    style={{ width: `${Math.min((cashInserted / cashProgressTotal) * 100, 100)}%` }}
                />
            </div>
            <p className="text-2xl font-bold" style={{ color: primaryTextColor }}>
                {formatVnd(cashInserted)} / {formatVnd(remainingAmount)}
            </p>
        </div>
    );

    const renderQr = () => (
        <div className="flex flex-col items-center gap-5">
            <QrCode size={72} style={{ color: primaryTextColor }} />
            <h3 className="text-3xl font-bold" style={{ color: primaryTextColor }}>Quét mã QR</h3>
            {voucher && <p className="text-lg font-bold" style={{ color: primaryTextColor }}>Cần thanh toán thêm {formatVnd(remainingAmount)}</p>}

            {qrError ? (
                <div className="max-w-md rounded-2xl border border-red-200 bg-red-50 p-5 text-center text-red-700">
                    <p className="font-bold">Chưa tạo được QR Sepay</p>
                    <p className="mt-2 text-sm">{qrError}</p>
                </div>
            ) : qrOrder ? (
                <>
                    <img
                        src={qrOrder.qr_url}
                        alt="QR thanh toán Sepay"
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
                    <p className="text-lg font-bold" style={{ color: primaryTextColor }}>Đang chờ Sepay xác nhận tự động...</p>
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
                className="mt-4 rounded-full bg-[#D5B895] px-8 py-3 font-bold text-white shadow-lg disabled:opacity-50"
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

    if (loading && method && method !== 'qr') {
        return (
            <div
                className="flex h-full flex-col items-center justify-center gap-4 bg-[#FFF8E7] bg-cover bg-center font-serif"
                style={{ backgroundImage: configs?.['bg_payment-wait'] ? `url('${configs['bg_payment-wait']}')` : 'none' }}
            >
                <Loader2 size={64} className="animate-spin" style={{ color: primaryTextColor }} />
                <p className="text-xl font-bold" style={{ color: primaryTextColor }}>Đang xử lý thanh toán...</p>
            </div>
        );
    }

    return (
        <div
            className="relative flex min-h-full w-full flex-col items-center justify-center bg-[#FFF8E7] bg-cover bg-center p-8 font-serif"
            style={{ backgroundImage: configs?.['bg_payment'] ? `url('${configs['bg_payment']}')` : 'none' }}
        >
            <button
                type="button"
                onClick={goBack}
                className="absolute left-6 top-6 z-10 flex items-center gap-2 rounded-full bg-white/80 px-6 py-3 font-bold shadow-sm backdrop-blur"
                style={{ color: primaryTextColor }}
            >
                <ArrowLeft size={24} />
                <span>Quay lại</span>
            </button>

            <div className="mx-auto flex w-full max-w-6xl flex-col items-center">
                {renderContent()}
            </div>

            {errorModal.show && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="mx-4 w-full max-w-md rounded-3xl border border-red-200 bg-white/95 p-8 shadow-2xl">
                        <div className="text-center">
                            <div className="mb-4 text-6xl text-red-500">!</div>
                            <h3 className="mb-4 text-2xl font-bold" style={{ color: secondaryTextColor }}>Lỗi thanh toán</h3>
                            <p className="mb-8 text-lg" style={{ color: primaryTextColor }}>{errorModal.message}</p>
                            <button
                                type="button"
                                onClick={() => {
                                    setErrorModal({ show: false, message: '' });
                                    setCode('');
                                }}
                                className="rounded-full bg-[#D5B895] px-8 py-3 font-bold text-white shadow-lg"
                            >
                                Đóng
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Payment;
