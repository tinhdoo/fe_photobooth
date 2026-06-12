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
    sepay: 'Sepay',
    code: 'Mã thanh toán',
};

const formatMoney = (value) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;
const formatTime = (value) => value ? new Date(value).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
}) : '--';

const StaffPanel = ({ onClose }) => {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState(null);
    const [printingId, setPrintingId] = useState(null);
    const [previewSession, setPreviewSession] = useState(null);

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

    const reprint = async (session, mode) => {
        const copies = mode === 'extra'
            ? Number(window.prompt('Nhập số bản in thêm:', '1') || 0)
            : 1;
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
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-6 font-sans"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
        >
            <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-[#E7D3B7] bg-[#FFF8E7] shadow-2xl">
                <div className="flex items-center justify-between border-b border-[#E7D3B7] bg-white px-6 py-4">
                    <div>
                        <h2 className="text-2xl font-black text-[#3F3127]">Staff Panel</h2>
                        <p className="text-sm font-semibold text-[#7B5E43]">Phiên gần đây, in lại và in thêm</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={fetchSessions}
                            className="inline-flex items-center gap-2 rounded-full border border-[#D5B895] bg-white px-4 py-2 font-bold text-[#7B5E43]"
                        >
                            <RefreshCcw size={18} />
                            Tải lại
                        </button>
                        <button
                            onClick={onClose}
                            className="rounded-full bg-[#8E6B4D] p-3 text-white"
                            aria-label="Đóng"
                        >
                            <X size={20} />
                        </button>
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
                                    <div key={session.uuid} className="grid grid-cols-[96px_1fr_auto] items-center gap-4 rounded-3xl border border-[#E7D3B7] bg-white p-4 shadow-sm">
                                        <button
                                            type="button"
                                            disabled={!previewUrl}
                                            onClick={() => previewUrl && setPreviewSession(session)}
                                            className="h-24 overflow-hidden rounded-2xl border border-[#EFE2CF] bg-[#FFF8E7] disabled:cursor-default"
                                            title={previewUrl ? 'Xem ảnh preview' : 'Chưa có ảnh preview'}
                                        >
                                            {previewUrl ? (
                                                <img src={previewUrl} alt={session.sessionId} className="h-full w-full object-cover" />
                                            ) : (
                                                <div className="flex h-full items-center justify-center text-[#D5B895]">
                                                    <AlertCircle />
                                                </div>
                                            )}
                                        </button>

                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="text-xl font-black text-[#2F3E46]">{session.sessionId}</h3>
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
                                                    className="inline-flex min-w-36 items-center justify-center gap-2 rounded-full border border-[#D5B895] bg-white px-4 py-2 font-black text-[#7B5E43]"
                                                >
                                                    <Eye size={18} />
                                                    Xem ảnh
                                                </button>
                                            )}
                                            <button
                                                disabled={!session.canReprint || isPrinting}
                                                onClick={() => reprint(session, 'retry')}
                                                className="inline-flex min-w-36 items-center justify-center gap-2 rounded-full bg-[#52796F] px-4 py-2 font-black text-white disabled:opacity-40"
                                            >
                                                <Printer size={18} />
                                                In lại do lỗi
                                            </button>
                                            <button
                                                disabled={!session.canReprint || isPrinting}
                                                onClick={() => reprint(session, 'extra')}
                                                className="inline-flex min-w-36 items-center justify-center gap-2 rounded-full bg-[#D5B895] px-4 py-2 font-black text-white disabled:opacity-40"
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
                                    Chưa có phiên chụp gần đây.
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
                                <h3 className="text-xl font-black text-[#2F3E46]">{previewSession.sessionId}</h3>
                                <p className="text-sm font-bold text-[#7B5E43]">
                                    {formatTime(previewSession.createdAt)} · {previewSession.layout || '--'}
                                </p>
                            </div>
                            <button
                                onClick={() => setPreviewSession(null)}
                                className="rounded-full bg-[#8E6B4D] p-3 text-white"
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
        </div>
    );
};

export default StaffPanel;
