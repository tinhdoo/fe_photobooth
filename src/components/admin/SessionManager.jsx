import { useState, useEffect } from 'react';
import axios from 'axios';
import { Calendar, Eye, Download, Search } from 'lucide-react';

const SessionManager = () => {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchSessions();
    }, []);

    const fetchSessions = async () => {
        try {
            const res = await axios.get('/api/sessions');
            setSessions(Array.isArray(res.data) ? res.data : []);
        } catch (error) {
            console.error("Failed to fetch sessions", error);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(amount || 0));
    };

    if (loading) return <div className="p-8">Đang tải danh sách phiên...</div>;

    return (
        <div className="space-y-8 animate-fadeIn">
            <h1 className="text-3xl text-[#2f3e46] font-bold">Thư viện Phiên chụp</h1>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50 text-left">
                            <tr>
                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">ID</th>
                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Xem trước</th>
                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Ngày tạo</th>
                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Phương thức</th>
                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Số tiền</th>
                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Hành động</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {sessions.map((session) => (
                                <tr key={session.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 text-sm font-mono text-gray-500">#{session.id}</td>
                                    <td className="px-6 py-4">
                                        {session.composite_url ? (
                                            <img
                                                src={session.composite_url}
                                                alt="Session Preview"
                                                className="h-16 w-auto rounded border border-gray-200 object-cover"
                                            />
                                        ) : (
                                            <span className="text-xs text-gray-400">Không có ảnh</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-[#2f3e46]">
                                        {new Date(session.created_at).toLocaleString('vi-VN')}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 rounded text-xs font-bold uppercase
                                            ${session.payment_method === 'code' ? 'bg-purple-100 text-purple-700' :
                                                session.payment_method === 'qr' ? 'bg-blue-100 text-blue-700' :
                                                    'bg-green-100 text-green-700'}`}>
                                            {session.payment_method || 'Không xác định'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 font-bold text-[#52796f]">
                                        {formatCurrency(session.amount)}
                                    </td>
                                    <td className="px-6 py-4">
                                        {session.composite_url && (
                                            <a
                                                href={session.composite_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-[#52796f] hover:text-[#3f6158] transition-colors"
                                                title="Xem kích thước đầy đủ"
                                            >
                                                <Eye size={20} />
                                            </a>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {sessions.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="px-6 py-12 text-center text-gray-400">
                                        Không tìm thấy phiên chụp nào.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default SessionManager;
