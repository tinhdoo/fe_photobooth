import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, User, ArrowRight } from 'lucide-react';

const AdminLogin = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleLogin = (e) => {
        e.preventDefault();

        // Simple client-side hardcoded authentication for now
        // In a real production app, this should call a backend API
        if (username === 'admin' && password === 'admin@photobooth') {
            if (rememberMe) {
                localStorage.setItem('isAuthenticated', 'true');
            } else {
                sessionStorage.setItem('isAuthenticated', 'true');
            }
            navigate('/admin');
        } else {
            setError('Tên đăng nhập hoặc mật khẩu không đúng');
        }
    };

    return (
        <div className="min-h-screen flexitems-center justify-center bg-[#F0F2E9] p-6 relative overflow-hidden flex flex-col pt-32">
            {/* Background elements */}
            <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-[#A8B5A0]/20 rounded-full blur-3xl" />
            <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-[#9BAD99]/20 rounded-full blur-3xl" />

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden relative z-10 p-10 border border-white/50 mx-auto"
            >
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-serif text-[#2f3e46] mb-3">Tomato Admin</h1>
                    <p className="text-[#52796f]">Đăng nhập để quản lý hệ thống</p>
                </div>

                {error && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-red-50 text-red-600 text-sm p-4 rounded-xl mb-6 text-center border border-red-100 font-medium"
                    >
                        {error}
                    </motion.div>
                )}

                <form onSubmit={handleLogin} className="space-y-6">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Tên đăng nhập</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                                <User size={18} />
                            </div>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:border-[#52796f] focus:ring-2 focus:ring-[#52796f]/20 outline-none transition-all"
                                placeholder="Nhập tên đăng nhập"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Mật khẩu</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                                <Lock size={18} />
                            </div>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:border-[#52796f] focus:ring-2 focus:ring-[#52796f]/20 outline-none transition-all"
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
                            className="h-4 w-4 text-[#52796f] focus:ring-[#52796f] border-gray-300 rounded cursor-pointer"
                        />
                        <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-700 cursor-pointer select-none font-medium">
                            Ghi nhớ đăng nhập
                        </label>
                    </div>

                    <button
                        type="submit"
                        className="w-full bg-[#52796f] text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#3f6154] transition-colors shadow-lg shadow-[#52796f]/20 mt-4 group"
                    >
                        Đăng nhập
                        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                </form>
            </motion.div>
        </div>
    );
};

export default AdminLogin;
