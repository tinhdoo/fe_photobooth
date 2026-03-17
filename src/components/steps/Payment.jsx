import { useState, useEffect } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { Banknote, QrCode, Hash, Loader2, CheckCircle, ArrowLeft } from 'lucide-react';
import { useWorkflow } from '../../context/WorkflowContext';
import { io } from "socket.io-client";
import { getDeviceId } from "../../utils/deviceId";

const Payment = () => {
    const { nextStep, prevStep, sessionData, updateSessionData } = useWorkflow();
    const [method, setMethod] = useState(null); // 'cash', 'qr', 'code'
    const [loading, setLoading] = useState(false);
    const [cashInserted, setCashInserted] = useState(0);
    const [code, setCode] = useState('');
    const [errorModal, setErrorModal] = useState({ show: false, message: '' });
    const PRICE = sessionData.printPrice || 60000;
    const printQuantity = sessionData.printQuantity || 1;

    const handleCodePayment = async () => {
        setLoading(true);
        try {
            const res = await axios.post('/api/codes/validate', { code });
            if (res.data.valid) {
                if (res.data.value >= PRICE) {
                    await axios.post(`/api/codes/${res.data.id}/use`);
                    handlePaymentSuccess('code');
                } else {
                    setErrorModal({
                        show: true,
                        message: `Mã có giá trị ${res.data.value.toLocaleString()}₫ thấp hơn yêu cầu ${PRICE.toLocaleString()}₫`
                    });
                    setLoading(false);
                }
            }
        } catch (error) {
            console.error("Payment Error:", error);
            if (error.response) {
                // Server returned error (4xx, 5xx)
                setErrorModal({
                    show: true,
                    message: error.response.data.message || "Lỗi xử lý thanh toán"
                });
            } else if (error.request) {
                // Network error (no response)
                setErrorModal({
                    show: true,
                    message: "Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng."
                });
            } else {
                // Other errors
                setErrorModal({
                    show: true,
                    message: "Đã có lỗi xảy ra. Vui lòng thử lại."
                });
            }
            setLoading(false);
        }
    };

    const handlePaymentSuccess = async (paymentMethod) => {
        setLoading(true);
        setTimeout(() => {
            setLoading(false);
            updateSessionData('paymentMethod', paymentMethod || method);
            updateSessionData('paymentStatus', 'completed');
            nextStep();
        }, 1000);
    };

    // Mock Cash Insertion & Real Bill Acceptor Listener
    useEffect(() => {
        // Socket for Bill Acceptor
        // Socket for Bill Acceptor
        const socket = io('/', {
            transports: ['polling'], // Force polling to avoid Invalid frame header on Windows threading backend
            reconnectionAttempts: 5,
            auth: { deviceId: getDeviceId() }
        });

        socket.on('connect_error', (err) => {
            console.warn("Socket connection error:", err.message);
        });

        socket.on('money_inserted', (data) => {
            console.log("💰 Money Inserted:", data.amount);
            // If user hasn't selected a method yet, auto-select cash?
            // Or just update balance regardless.
            if (!method || method === 'cash') {
                if (method !== 'cash') setMethod('cash');
                setCashInserted(prev => {
                    const newValue = prev + data.amount;
                    return newValue;
                });
            }
        });

        return () => socket.disconnect();
    }, [method]);

    // Check Balance for Success
    useEffect(() => {
        if (method === 'cash' && cashInserted >= PRICE) {
            handlePaymentSuccess('cash');
        }
    }, [method, cashInserted, PRICE]);

    // Mock Simulation (Keep for testing without hardware)
    useEffect(() => {
        // Only run mock if explicitly enabled or maybe keypress? 
        // Let's remove auto-mock to avoid confusion with real money, 
        // OR make it slower/require manual trigger. 
        // For now, I'll Comment out the auto-increment mock to rely on real hardware or manual simulation.
        /*
        if (method === 'cash' && cashInserted < PRICE) {
            const interval = setInterval(() => {
                setCashInserted(prev => Math.min(prev + 10000, PRICE));
            }, 1500);
            return () => clearInterval(interval);
        }
        */
    }, [method]);

    const renderContent = () => {
        if (!method) {
            const methods = [
                { id: 'cash', icon: <Banknote size={56} className="text-[#52796f]" />, label: 'Tiền mặt' },
                { id: 'qr', icon: <QrCode size={56} className="text-[#52796f]" />, label: 'Chuyển khoản' },
                { id: 'code', icon: <Hash size={56} className="text-[#52796f]" />, label: 'Nhập mã' },
            ];

            return (
                <div className="flex flex-col items-center w-full max-w-4xl mx-auto relative">
                    {/* Header */}
                    <motion.h2
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-5xl font-serif text-[#52796f] text-center mb-12 tracking-wider uppercase"
                    >
                        THANH TOÁN
                    </motion.h2>

                    {/* Price Card */}
                    <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        className="bg-white rounded-[1.5rem] shadow-sm border border-gray-100 p-8 w-full max-w-md text-center mb-10 relative"
                    >
                        <h2 className="text-5xl font-bold text-[#354f52] font-serif mb-2 tracking-tight">
                            {PRICE.toLocaleString()}₫
                        </h2>
                        <div className="w-full h-px bg-gray-200 my-4"></div>
                        <p className="text-xl text-[#52796f] font-serif opacity-80">Số lượng: {printQuantity}</p>
                    </motion.div>

                    {/* Divider */}
                    <div className="flex items-center gap-4 w-full max-w-lg mb-10 opacity-60">
                        <div className="h-[1px] bg-[#A8B5A0] flex-1 rounded-full"></div>
                        <span className="text-[#52796f] font-serif text-lg italic whitespace-nowrap">Chọn phương thức thanh toán</span>
                        <div className="h-[1px] bg-[#A8B5A0] flex-1 rounded-full"></div>
                    </div>

                    {/* Method Cards Grid */}
                    <div className="grid grid-cols-3 gap-6 w-full max-w-3xl">
                        {methods.map((m, i) => (
                            <motion.button
                                key={m.id}
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: i * 0.1 }}
                                whileHover={{ scale: 1.03, y: -5 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => setMethod(m.id)}
                                className="bg-white rounded-[2rem] shadow-sm hover:shadow-xl border border-gray-100 p-6 flex flex-col items-center justify-center gap-4 aspect-square transition-all group"
                            >
                                <div className="p-4 bg-[#F9FAF7] rounded-full group-hover:bg-[#ebf2e8] transition-colors">
                                    {/* Resize icons implicitly or explicitly if needed, but p-4 reduces container size */}
                                    {m.id === 'cash' && <Banknote size={40} className="text-[#52796f]" />}
                                    {m.id === 'qr' && <QrCode size={40} className="text-[#52796f]" />}
                                    {m.id === 'code' && <Hash size={40} className="text-[#52796f]" />}
                                </div>
                                <span className="text-xl font-bold text-[#52796f] font-serif group-hover:text-[#354f52] transition-colors">
                                    {m.label}
                                </span>
                            </motion.button>
                        ))}
                    </div>
                </div>
            );
        }

        return (
            <div className="bg-white border-2 border-[#A8B5A0] p-12 rounded-3xl w-full max-w-2xl text-center relative shadow-xl">
                {/* Back button removed from here as it is now global */}

                {method === 'cash' && (
                    <div className="flex flex-col items-center gap-6">
                        <Banknote size={80} className="text-[#84a98c] animate-bounce" />
                        <h3 className="text-3xl font-bold text-[#52796f]">Đưa tiền vào khe bên dưới</h3>
                        <div className="w-full bg-[#CAD2C5] h-6 rounded-full overflow-hidden">
                            <motion.div
                                className="bg-[#A8B5A0] h-full"
                                initial={{ width: 0 }}
                                animate={{ width: `${(cashInserted / PRICE) * 100}%` }}
                            />
                        </div>
                        <p className="text-2xl font-bold text-[#52796f]">
                            {cashInserted.toLocaleString()} / {PRICE.toLocaleString()}₫
                        </p>
                    </div>
                )}

                {
                    method === 'qr' && (
                        <div className="flex flex-col items-center gap-6">
                            <QrCode size={80} className="text-[#A8B5A0]" />
                            <h3 className="text-3xl font-bold text-[#52796f]">Quét mã QR</h3>
                            <div className="w-64 h-64 bg-white border-2 border-[#A8B5A0] flex items-center justify-center rounded-lg">
                                <p className="text-[#52796f]">Mã QR ở đây</p>
                            </div>
                            <button
                                onClick={() => handlePaymentSuccess('qr')}
                                className="bg-blue-600 px-8 py-3 rounded-full font-bold hover:bg-blue-500"
                            >
                                Simulate Payment Success
                            </button>
                        </div>
                    )
                }

                {
                    method === 'code' && (
                        <div className="flex flex-col items-center gap-6">
                            <Hash size={80} className="text-[#A8B5A0]" />
                            <h3 className="text-3xl font-bold text-[#52796f]">Nhập mã</h3>

                            {/* Code Display */}
                            <div className="flex gap-2 mb-4">
                                {[...Array(6)].map((_, i) => (
                                    <div
                                        key={i}
                                        className="w-12 h-16 bg-[#CAD2C5] border-2 border-[#A8B5A0] rounded-lg flex items-center justify-center text-2xl font-bold text-[#52796f]"
                                    >
                                        {code[i] || ''}
                                    </div>
                                ))}
                            </div>

                            {/* Numeric Keypad */}
                            <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                                    <button
                                        key={num}
                                        onClick={() => code.length < 6 && setCode(code + num)}
                                        className="bg-[#CAD2C5] hover:bg-[#A8B5A0] hover:text-white border-2 border-[#A8B5A0] rounded-xl py-4 text-2xl font-bold transition-all active:scale-95 text-[#52796f]"
                                    >
                                        {num}
                                    </button>
                                ))}
                                <button
                                    onClick={() => setCode('')}
                                    className="bg-red-100 hover:bg-red-200 border-2 border-red-300 text-red-600 rounded-xl py-4 text-lg font-bold transition-all active:scale-95"
                                >
                                    Xóa
                                </button>
                                <button
                                    onClick={() => code.length < 6 && setCode(code + '0')}
                                    className="bg-[#CAD2C5] hover:bg-[#A8B5A0] hover:text-white border-2 border-[#A8B5A0] rounded-xl py-4 text-2xl font-bold transition-all active:scale-95 text-[#52796f]"
                                >
                                    0
                                </button>
                                <button
                                    onClick={() => setCode(code.slice(0, -1))}
                                    className="bg-yellow-100 hover:bg-yellow-200 border-2 border-yellow-300 text-yellow-700 rounded-xl py-4 text-lg font-bold transition-all active:scale-95"
                                >
                                    ⌫
                                </button>
                            </div>

                            <button
                                onClick={handleCodePayment}
                                disabled={loading || code.length !== 6}
                                className="bg-[#A8B5A0] text-white px-8 py-3 rounded-full font-bold hover:bg-[#84a98c] disabled:opacity-50 mt-4 shadow-lg"
                            >
                                Xác nhận
                            </button>
                        </div>
                    )
                }
            </div >
        );
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <Loader2 size={64} className="animate-spin text-[#52796f]" />
                <p className="text-xl text-[#52796f]">Đang xử lý thanh toán...</p>
            </div>
        );
    }

    return (
        <div className="min-h-full w-full flex flex-col items-center justify-center p-8 bg-[#F9FAF7] relative">
            {/* Back Button - Only show if not in sub-flow (method selection) or if needed universally */}
            {/* User requested Back button for Payment screen top-left like PrintQuantity */}
            <button
                onClick={() => {
                    if (method) {
                        setMethod(null);
                        setCashInserted(0);
                    } else {
                        prevStep();
                    }
                }}
                className="absolute top-6 left-6 flex items-center gap-2 px-6 py-3 bg-white hover:bg-gray-50 text-[#52796f] rounded-full transition-all font-serif font-bold shadow-sm hover:shadow-md border border-[#A8B5A0]/20 z-10"
            >
                <ArrowLeft size={24} />
                <span>Quay Lại</span>
            </button>

            {/* Main Content Area */}
            <div className="w-full max-w-6xl mx-auto flex flex-col items-center">
                {renderContent()}
            </div>

            {/* Error Modal */}
            {errorModal.show && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="bg-white/90 backdrop-blur-md border border-red-200 rounded-3xl p-8 max-w-md w-full mx-4 shadow-2xl"
                    >
                        <div className="text-center">
                            <div className="text-red-500 text-6xl mb-4">⚠️</div>
                            <h3 className="text-2xl font-bold mb-4 text-[#354f52]">Lỗi thanh toán</h3>
                            <p className="text-lg mb-8 text-[#52796f]">{errorModal.message}</p>
                            <button
                                onClick={() => {
                                    setErrorModal({ show: false, message: '' });
                                    setCode('');
                                }}
                                className="bg-[#52796f] text-white px-8 py-3 rounded-full font-bold hover:bg-[#354f52] transition-all shadow-lg"
                            >
                                Đóng
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
};

export default Payment;
