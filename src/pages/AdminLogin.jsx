import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import axios from 'axios';
import { Lock, User, ArrowRight, RefreshCw } from 'lucide-react';
import { useWorkflow } from '../context/WorkflowContext';
import { CLOUD_API_URL } from '../config/api';
import { isLocalHost } from '../utils/runtime';
import { saveAuth } from '../utils/auth';

const AdminLogin = () => {
    const { configs } = useWorkflow();
    const logoUrl = configs?.logo_main || '/logo_tomato.png';
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');

        // Máy booth (localhost): đăng nhập offline bằng tài khoản cứng, KHÔNG cần mạng.
        if (isLocalHost()) {
            if (username === 'admin' && password === 'admin@photobooth') {
                saveAuth({ username: 'admin', display_name: 'Quản trị', role: 'admin' }, rememberMe);
                navigate('/admin');
            } else {
                setError('Tên đăng nhập hoặc mật khẩu không đúng');
            }
            return;
        }

        // Cloud (Vercel): xác thực qua API, nhận token + role.
        setLoading(true);
        try {
            const res = await axios.post(`${CLOUD_API_URL}/api/codes`, {
                action: 'login',
                username: username.trim(),
                password,
            });
            const { token, role, display_name } = res.data || {};
            if (!token) throw new Error('Phản hồi không hợp lệ');
            saveAuth({ token, role, username: username.trim(), display_name }, rememberMe);
            navigate('/admin');
        } catch (err) {
            setError(err?.response?.data?.error || 'Đăng nhập thất bại. Kiểm tra lại tài khoản.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gray-50 p-6 pt-24">
            <div className="absolute left-[-10%] top-[-10%] h-96 w-96 rounded-full bg-[#e63946]/5 blur-3xl" />
            <div className="absolute bottom-[-10%] right-[-10%] h-96 w-96 rounded-full bg-[#e63946]/5 blur-3xl" />

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative z-10 mx-auto w-full max-w-md overflow-hidden rounded-3xl border border-white/50 bg-white p-10 shadow-xl"
            >
                <div className="mb-10 text-center">
                    <img
                        src={logoUrl}
                        onError={(e) => { if (!e.currentTarget.src.endsWith('/logo_tomato.png')) e.currentTarget.src = '/logo_tomato.png'; }}
                        alt="Tomato Photobooth"
                        className="mx-auto mb-4 h-20 w-20 rounded-full object-contain"
                    />
                    <h1 className="mb-3 font-serif text-4xl font-extrabold text-[#1a1a2e]">Tomato Admin</h1>
                    <p className="text-gray-500">Đăng nhập để quản lý hệ thống</p>
                </div>

                {error && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="mb-6 rounded-xl border border-red-100 bg-red-50 p-4 text-center text-sm font-medium text-red-600"
                    >
                        {error}
                    </motion.div>
                )}

                <form onSubmit={handleLogin} className="space-y-6">
                    <div>
                        <label className="mb-2 block text-sm font-bold text-gray-700">Tên đăng nhập</label>
                        <div className="relative">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-gray-400">
                                <User size={18} />
                            </div>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full rounded-xl border border-gray-200 py-3 pl-11 pr-4 outline-none transition-all focus:border-[#e63946] focus:ring-2 focus:ring-[#e63946]/20 bg-gray-50 focus:bg-white"
                                placeholder="Nhập tên đăng nhập"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-bold text-gray-700">Mật khẩu</label>
                        <div className="relative">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-gray-400">
                                <Lock size={18} />
                            </div>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full rounded-xl border border-gray-200 py-3 pl-11 pr-4 outline-none transition-all focus:border-[#e63946] focus:ring-2 focus:ring-[#e63946]/20 bg-gray-50 focus:bg-white"
                                placeholder="Nhập mật khẩu"
                                required
                            />
                        </div>
                    </div>

                    <div className="flex items-center">
                        <input
                            id="remember-me"
                            type="checkbox"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            className="h-4 w-4 cursor-pointer rounded border-gray-300 text-[#e63946] focus:ring-[#e63946]"
                        />
                        <label htmlFor="remember-me" className="ml-2 block cursor-pointer select-none text-sm font-medium text-gray-700">
                            Ghi nhớ đăng nhập
                        </label>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="group mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#e63946] py-4 font-bold text-white shadow-lg shadow-[#e63946]/20 transition-colors hover:bg-[#d62828] disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <><RefreshCw size={18} className="animate-spin" /> Đang đăng nhập...</>
                        ) : (
                            <>Đăng nhập<ArrowRight size={18} className="transition-transform group-hover:translate-x-1" /></>
                        )}
                    </button>
                </form>
            </motion.div>
        </div>
    );
};

export default AdminLogin;
