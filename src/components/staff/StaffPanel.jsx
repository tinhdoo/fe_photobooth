import { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertCircle, Eye, Printer, RefreshCcw, X } from 'lucide-react';

const statusLabel = {
    sent: 'Đã in',
    failed: 'Lỗi in',
    pending: 'Đang chờ',
    not_printed: 'Chưa in',
};

const paymentLabel = {
    cash: 'Tiền mặt',
    qr: 'QR',
    sepay: 'Tomato',
    code: 'Mã thanh toán',
};

const formatMoney = (value) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;
const formatTime = (value) => value ? new Date(value).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
}) : '--';

const StaffPanel = ({ onClose, embedded = false }) => {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState(null);
    const [printingId, setPrintingId] = useState(null);
    const [previewSession, setPreviewSession] = useState(null);
    const [extraPrintSession, setExtraPrintSession] = useState(null);
    const [extraCopies, setExtraCopies] = useState('1');

    const fetchSessions = async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/staff/sessions/recent', { params: { limit: 30 } });
            setSessions(Array.isArray(res.data) ? res.data : []);
        } catch (error) {
            setMessage({ type: 'error', text: error.response?.data?.error || 'Không tải được lịch sử phiên.' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSessions();
    }, []);

    const reprint = async (session, mode, requestedCopies = 1) => {
        const copies = Number(requestedCopies || 0);
        if (!Number.isFinite(copies) || copies < 1) return;

        setPrintingId(`${session.uuid}-${mode}`);
        setMessage(null);
        try {
            await axios.post(`/api/staff/sessions/${session.uuid}/reprint`, {
                copies,
                reason: mode,
            });
            setMessage({
                type: 'success',
                text: mode === 'extra' ? `Đã gửi lệnh in thêm ${copies} bản.` : 'Đã gửi lệnh in lại miễn phí.',
            });
            fetchSessions();
        } catch (error) {
            setMessage({ type: 'error', text: error.response?.data?.error || 'Không gửi được lệnh in.' });
        } finally {
            setPrintingId(null);
        }
    };

    return (
        <div
            className={embedded
                ? "relative h-full w-full font-sans"
                : "fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-6 font-sans"}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
        >
            <div className={embedded
                ? "mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden bg-[#FFFDF2] animate-fadeIn"
                : "flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-gray-100 bg-[#FFFDF2] shadow-2xl"}>
                <div className={`flex items-center justify-between px-6 pt-6 pb-4 ${embedded ? '' : 'border-b border-gray-100 bg-white'}`}>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold text-[#1a1a2e] tracking-tight">In lại / In thêm</h1>
                        <p className="mt-1 text-sm md:text-base text-[#e63946]">Phiên chụp hôm nay — in lại miễn phí hoặc in thêm bản.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={fetchSessions}
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 font-bold text-[#7B5E43] hover:bg-gray-50"
                        >
                            <RefreshCcw size={18} />
                            Tải lại
                        </button>
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="rounded-full bg-[#987351] p-3 text-white transition-colors hover:bg-[#7B5E43]"
                                aria-label="Đóng"
                            >
                                <X size={20} />
                            </button>
                        )}
                    </div>
                </div>

                {message && (
                    <div className={`mx-6 mt-4 rounded-2xl border px-4 py-3 font-bold ${message.type === 'success'
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : 'border-red-200 bg-red-50 text-red-700'
                        }`}>
                        {message.text}
                    </div>
                )}

                <div className="overflow-auto p-6">
                    {loading ? (
                        <div className="rounded-3xl bg-white p-10 text-center font-bold text-[#7B5E43]">Đang tải lịch sử...</div>
                    ) : (
                        <div className="space-y-3">
                            {sessions.map((session) => {
                                const isFailed = session.printStatus === 'failed';
                                const isPrinting = printingId?.startsWith(session.uuid);
                                const previewUrl = session.previewUrl || session.finalImageUrl;
                                return (
                                    <div key={session.uuid} className="grid grid-cols-[96px_1fr_auto] items-center gap-4 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
                                        <button
                                            type="button"
                                            disabled={!previewUrl}
                                            onClick={() => previewUrl && setPreviewSession(session)}
                                            className="h-24 overflow-hidden rounded-2xl border border-gray-100 bg-[#FFFDF2] disabled:cursor-default"
                                            title={previewUrl ? 'Xem ảnh preview' : 'Chưa có ảnh preview'}
                                        >
                                            {previewUrl ? (
                                                <img src={previewUrl} alt={session.sessionId} className="h-full w-full object-cover" />
                                            ) : (
                                                <div className="flex h-full items-center justify-center text-gray-300">
                                                    <AlertCircle />
                                                </div>
                                            )}
                                        </button>

                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="text-xl font-black text-[#1a1a2e]">{session.sessionId}</h3>
                                                <span className={`rounded-full px-3 py-1 text-xs font-black ${isFailed ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
                                                    {statusLabel[session.printStatus] || session.printStatus}
                                                </span>
                                            </div>
                                            <p className="mt-1 text-sm font-bold text-[#7B5E43]">
                                                {formatTime(session.createdAt)} · {session.layout || '--'} · {formatMoney(session.amount)} · {paymentLabel[session.paymentMethod] || session.paymentMethod || '--'}
                                            </p>
                                            <p className="mt-1 truncate text-xs font-semibold text-[#5E6B78]" title={session.finalImagePath || ''}>
                                                File in: {session.finalImagePath || 'Chưa có file local'}
                                            </p>
                                            {session.printError && (
                                                <p className="mt-1 text-xs font-bold text-red-600">{session.printError}</p>
                                            )}
                                        </div>

                                        <div className="flex flex-col gap-2">
                                            {previewUrl && (
                                                <button
                                                    type="button"
                                                    onClick={() => setPreviewSession(session)}
                                                    className="inline-flex min-w-36 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 font-black text-[#7B5E43] hover:bg-gray-50"
                                                >
                                                    <Eye size={18} />
                                                    Xem ảnh
                                                </button>
                                            )}
                                            <button
                                                disabled={!session.canReprint || isPrinting}
                                                onClick={() => reprint(session, 'retry', session.copies || 1)}
                                                className="inline-flex min-w-36 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 font-black text-[#7B5E43] hover:bg-gray-50 disabled:opacity-40"
                                            >
                                                <Printer size={18} />
                                                In lại do lỗi
                                            </button>
                                            <button
                                                disabled={!session.canReprint || isPrinting}
                                                onClick={() => {
                                                    setExtraPrintSession(session);
                                                    setExtraCopies('1');
                                                }}
                                                className="inline-flex min-w-36 items-center justify-center gap-2 rounded-lg bg-[#DDBF9B] px-4 py-2 font-black text-white hover:bg-[#cda87f] disabled:opacity-40"
                                            >
                                                <Printer size={18} />
                                                In thêm bản
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}

                            {sessions.length === 0 && (
                                <div className="rounded-3xl bg-white p-10 text-center font-bold text-[#7B5E43]">
                                    Chưa có phiên chụp nào hôm nay.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {previewSession && (
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-6"
                    onClick={() => setPreviewSession(null)}
                >
                    <div
                        className="max-h-[92vh] max-w-[92vw] overflow-hidden rounded-3xl bg-white p-4 shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="mb-3 flex items-center justify-between gap-4">
                            <div>
                                <h3 className="text-xl font-black text-[#1a1a2e]">{previewSession.sessionId}</h3>
                                <p className="text-sm font-bold text-[#7B5E43]">
                                    {formatTime(previewSession.createdAt)} · {previewSession.layout || '--'}
                                </p>
                            </div>
                            <button
                                onClick={() => setPreviewSession(null)}
                                className="rounded-full bg-[#987351] p-3 text-white transition-colors hover:bg-[#7B5E43]"
                                aria-label="Đóng preview"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <img
                            src={previewSession.previewUrl || previewSession.finalImageUrl}
                            alt={previewSession.sessionId}
                            className="max-h-[78vh] max-w-[86vw] rounded-2xl object-contain"
                        />
                    </div>
                </div>
            )}

            {extraPrintSession && (
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-6"
                    onClick={() => setExtraPrintSession(null)}
                >
                    <div
                        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <h3 className="text-2xl font-black text-[#1a1a2e]">In thêm bản</h3>
                        <p className="mt-1 text-sm font-bold text-[#7B5E43]">
                            {extraPrintSession.sessionId} · {extraPrintSession.layout || '--'}
                        </p>
                        <label className="mt-5 block">
                            <span className="mb-2 block text-sm font-black text-[#1a1a2e]">Số bản in thêm</span>
                            <input
                                type="number"
                                min="1"
                                max="20"
                                value={extraCopies}
                                onChange={(event) => setExtraCopies(event.target.value)}
                                className="h-14 w-full rounded-lg border border-gray-200 bg-white px-4 text-center text-2xl font-black text-[#1a1a2e] focus:border-[#DDBF9B] focus:outline-none"
                                autoFocus
                            />
                        </label>
                        <div className="mt-6 grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setExtraPrintSession(null)}
                                className="rounded-lg border border-gray-200 bg-white py-3 font-black text-[#7B5E43] hover:bg-gray-50"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={() => {
                                    const session = extraPrintSession;
                                    const copies = extraCopies;
                                    setExtraPrintSession(null);
                                    reprint(session, 'extra', copies);
                                }}
                                className="rounded-lg bg-[#DDBF9B] py-3 font-black text-white hover:bg-[#cda87f]"
                            >
                                In thêm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StaffPanel;
