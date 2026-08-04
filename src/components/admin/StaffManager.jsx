import { useState, useEffect } from 'react';
import axios from 'axios';
import { RefreshCw, UserPlus, User, Lock, ShieldCheck, KeyRound, CheckCircle, XCircle, Ban, Check } from 'lucide-react';
import { authHeader } from '../../utils/auth';
import { errorMessage } from '../../utils/errorMessage';

const roleLabel = (role) => (role === 'admin' ? 'Quản trị' : 'Nhân viên');

const StaffManager = () => {
    const [staff, setStaff] = useState([]);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({ display_name: '', username: '', password: '', role: 'staff' });
    const [notification, setNotification] = useState({ show: false, message: '', type: 'success' });
    const [resetFor, setResetFor] = useState(null); // { id, username }
    const [resetPwd, setResetPwd] = useState('');

    const notify = (message, type = 'success') => setNotification({ show: true, message, type });

    const fetchStaff = async () => {
        try {
            const res = await axios.get('/api/codes?action=staff-list', { headers: authHeader() });
            setStaff(Array.isArray(res.data) ? res.data : []);
        } catch (error) {
            notify(errorMessage(error, 'Không tải được danh sách nhân viên.'), 'error');
        }
    };

    useEffect(() => { fetchStaff(); }, []);

    const handleCreate = async (e) => {
        e.preventDefault();
        const username = form.username.trim().toLowerCase();
        if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
            notify('Tên đăng nhập 3-32 ký tự, chỉ chữ thường/số/._-', 'error');
            return;
        }
        if (form.password.length < 6) {
            notify('Mật khẩu tối thiểu 6 ký tự.', 'error');
            return;
        }
        setLoading(true);
        try {
            await axios.post('/api/codes', {
                action: 'staff-create',
                username,
                password: form.password,
                display_name: form.display_name.trim() || username,
                role: form.role,
            }, { headers: authHeader() });
            setForm({ display_name: '', username: '', password: '', role: 'staff' });
            notify('Đã tạo tài khoản nhân viên.');
            fetchStaff();
        } catch (error) {
            notify(errorMessage(error, 'Tạo tài khoản thất bại.'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const toggleActive = async (acc) => {
        try {
            await axios.post('/api/codes', { action: 'staff-toggle', id: acc.id, active: !acc.active }, { headers: authHeader() });
            setStaff(prev => prev.map(s => (s.id === acc.id ? { ...s, active: !acc.active } : s)));
        } catch (error) {
            notify(errorMessage(error, 'Không đổi được trạng thái.'), 'error');
        }
    };

    const submitReset = async () => {
        if (resetPwd.length < 6) {
            notify('Mật khẩu tối thiểu 6 ký tự.', 'error');
            return;
        }
        try {
            await axios.post('/api/codes', { action: 'staff-reset', id: resetFor.id, password: resetPwd }, { headers: authHeader() });
            setResetFor(null);
            setResetPwd('');
            notify('Đã đổi mật khẩu.');
        } catch (error) {
            notify(errorMessage(error, 'Đổi mật khẩu thất bại.'), 'error');
        }
    };

    return (
        <div className="animate-fadeIn">
            <div className="mb-4 lg:mb-8">
                <h1 className="text-2xl md:text-3xl font-bold text-[#1a1a2e] tracking-tight">Nhân viên</h1>
                <p className="text-sm md:text-base text-gray-500 mt-1">Tạo tài khoản để nhân viên lấy mã thanh toán và ghi chú.</p>
            </div>

            <div className="flex flex-col xl:flex-row gap-6">
                {/* --- FORM TẠO --- */}
                <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-100 w-full xl:w-1/3 h-fit">
                    <h3 className="text-lg md:text-xl font-bold text-[#1a1a2e] mb-4 flex items-center gap-2 pb-3 border-b border-gray-100">
                        <UserPlus className="bg-[#e63946] text-white rounded-full p-1" size={24} />
                        Thêm nhân viên
                    </h3>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tên hiển thị</label>
                            <input
                                type="text"
                                value={form.display_name}
                                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                                placeholder="Tên hiển thị"
                                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#e63946] bg-gray-50 focus:bg-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tên đăng nhập</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                <input
                                    type="text"
                                    value={form.username}
                                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                                    placeholder="chữ thường, số, . _ -"
                                    autoComplete="off"
                                    className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#e63946] bg-gray-50 focus:bg-white text-sm"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mật khẩu</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                <input
                                    type="text"
                                    value={form.password}
                                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                                    placeholder="tối thiểu 6 ký tự"
                                    autoComplete="new-password"
                                    className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#e63946] bg-gray-50 focus:bg-white text-sm"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Vai trò</label>
                            <select
                                value={form.role}
                                onChange={(e) => setForm({ ...form, role: e.target.value })}
                                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#e63946] bg-gray-50 focus:bg-white text-sm"
                            >
                                <option value="staff">Nhân viên (chỉ Mã thanh toán)</option>
                                <option value="admin">Quản trị (toàn quyền)</option>
                            </select>
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 bg-[#e63946] text-white rounded-xl font-bold hover:bg-[#c1121f] transition-all disabled:opacity-70 shadow-lg shadow-[#e63946]/20 active:scale-[0.98] flex items-center justify-center gap-2"
                        >
                            {loading ? <><RefreshCw className="animate-spin" size={18} /> Đang tạo...</> : <><UserPlus size={18} /> Tạo tài khoản</>}
                        </button>
                    </form>
                </div>

                {/* --- DANH SÁCH --- */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex-1 overflow-hidden flex flex-col">
                    <div className="p-5 md:p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                        <h3 className="text-lg md:text-xl font-bold text-[#1a1a2e]">Danh sách tài khoản</h3>
                        <button onClick={fetchStaff} className="p-2.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl text-gray-600 shadow-sm active:scale-95" title="Làm mới">
                            <RefreshCw size={18} />
                        </button>
                    </div>

                    <div className="divide-y divide-gray-100">
                        {staff.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 italic">Chưa có tài khoản nào.</div>
                        ) : (
                            staff.map((acc) => (
                                <div key={acc.id} className="p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-gray-50/60">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-[#1a1a2e]">{acc.display_name}</span>
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${acc.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                {acc.role === 'admin' ? <ShieldCheck size={11} /> : <User size={11} />}{roleLabel(acc.role)}
                                            </span>
                                            {!acc.active && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-600">Đã khóa</span>}
                                        </div>
                                        <div className="text-sm text-gray-500 font-mono mt-0.5">@{acc.username}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => { setResetFor({ id: acc.id, username: acc.username }); setResetPwd(''); }}
                                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all"
                                            title="Đổi mật khẩu"
                                        >
                                            <KeyRound size={15} /> Mật khẩu
                                        </button>
                                        <button
                                            onClick={() => toggleActive(acc)}
                                            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all ${acc.active ? 'text-red-600 bg-red-50 hover:bg-red-100' : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'}`}
                                            title={acc.active ? 'Khóa tài khoản' : 'Mở khóa'}
                                        >
                                            {acc.active ? <><Ban size={15} /> Khóa</> : <><Check size={15} /> Mở</>}
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Modal đổi mật khẩu */}
            {resetFor && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
                        <h3 className="text-lg font-bold text-gray-800 mb-1">Đổi mật khẩu</h3>
                        <p className="text-sm text-gray-500 mb-4 font-mono">@{resetFor.username}</p>
                        <input
                            type="text"
                            value={resetPwd}
                            onChange={(e) => setResetPwd(e.target.value)}
                            placeholder="Mật khẩu mới (≥ 6 ký tự)"
                            autoComplete="new-password"
                            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#e63946] bg-gray-50 focus:bg-white text-sm mb-4"
                        />
                        <div className="flex gap-3">
                            <button onClick={() => { setResetFor(null); setResetPwd(''); }} className="flex-1 py-3 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200">Hủy</button>
                            <button onClick={submitReset} className="flex-1 py-3 rounded-xl font-bold text-white bg-[#e63946] hover:bg-[#c1121f] flex items-center justify-center gap-2"><Check size={18} /> Lưu</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Notification */}
            {notification.show && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
                        <div className="flex flex-col items-center text-center">
                            <div className={`mb-4 p-4 rounded-full ${notification.type === 'success' ? 'bg-green-50 text-emerald-500' : 'bg-red-50 text-red-500'}`}>
                                {notification.type === 'success' ? <CheckCircle size={40} strokeWidth={2.5} /> : <XCircle size={40} strokeWidth={2.5} />}
                            </div>
                            <h3 className="text-xl font-bold text-gray-800 mb-2">{notification.type === 'success' ? 'Thành công' : 'Đã xảy ra lỗi'}</h3>
                            <p className="text-gray-500 mb-6 font-medium">{String(notification.message ?? '')}</p>
                            <button
                                onClick={() => setNotification({ ...notification, show: false })}
                                className={`w-full py-3.5 rounded-xl font-bold text-white transition-all active:scale-[0.98] ${notification.type === 'success' ? 'bg-[#e63946] hover:bg-[#c1121f]' : 'bg-red-500 hover:bg-red-600'}`}
                            >
                                Đã hiểu
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StaffManager;
