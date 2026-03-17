import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Layout, Home, Camera, DollarSign, TrendingUp, Settings, Monitor, Banknote, Menu, X, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const AdminLayout = () => {
    const location = useLocation();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
    const closeSidebar = () => setIsSidebarOpen(false);

    const menuItems = [
        { to: '/admin/codes', icon: <DollarSign size={20} />, label: 'Mã thanh toán' },
        { to: '/admin', icon: <Layout size={20} />, label: 'Khung hình' },
        { to: '/admin/revenue', icon: <TrendingUp size={20} />, label: 'Doanh thu' },
        { to: '/admin/bill-settings', icon: <Banknote size={20} />, label: 'Đầu đọc tiền' },
        { to: '/admin/settings', icon: <Settings size={20} />, label: 'Cài đặt' },
    ];

    return (
        <div className="flex h-screen bg-[#F0F2E9]">
            {/* Mobile Header (Only on small screens) */}
            <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 z-40">
                <h1 className="text-xl font-serif text-[#2f3e46]">Tomato Admin</h1>
                <button
                    onClick={toggleSidebar}
                    className="p-2 text-[#52796f] hover:bg-gray-100 rounded-lg transition-colors"
                >
                    {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
            </div>

            {/* Sidebar Backdrop Overlay (Mobile only) */}
            <AnimatePresence>
                {isSidebarOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={closeSidebar}
                        className="lg:hidden fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
                    />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            <div className={`
                fixed lg:relative inset-y-0 left-0 w-64 bg-white border-r border-gray-200 flex flex-col z-50 transform transition-transform duration-300 ease-in-out
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
            `}>
                <div className="p-6 border-b border-gray-100 hidden lg:block">
                    <h1 className="text-2xl font-serif text-[#2f3e46]">Tomato Admin</h1>
                </div>

                {/* Mobile Sidebar Brand Info */}
                <div className="p-6 border-b border-gray-100 lg:hidden flex items-center justify-between">
                    <h1 className="text-xl font-serif text-[#2f3e46]">Tomato Admin</h1>
                    <button onClick={closeSidebar} className="p-2 text-gray-400">
                        <X size={20} />
                    </button>
                </div>

                <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                    {menuItems.map((item) => (
                        <Link
                            key={item.to}
                            to={item.to}
                            onClick={closeSidebar}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${location.pathname === item.to
                                ? 'bg-[#A8B5A0] text-white'
                                : 'text-[#52796f] hover:bg-[#F9FAF7]'
                                }`}
                        >
                            {item.icon}
                            <span className="font-medium">{item.label}</span>
                        </Link>
                    ))}
                    <button
                        onClick={() => {
                            localStorage.removeItem('isAuthenticated');
                            sessionStorage.removeItem('isAuthenticated');
                            // Use window.location.href or a navigate hook. Since we are in a router, we should use useNavigate hook.
                            // I will add useNavigate to the imports and use it.
                            window.location.href = '/admin/login';
                        }}
                        className="w-full flex items-center justify-start gap-3 px-4 py-3 rounded-xl text-[#e63946] hover:bg-red-50 mt-8 border-t border-gray-50 pt-8 transition-colors"
                    >
                        <LogOut size={20} />
                        <span className="font-medium">Đăng xuất</span>
                    </button>
                </nav>

                <div className="p-6 border-t border-gray-100 text-xs text-gray-400">
                    v1.0.0
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto pt-16 lg:pt-0">
                <main className="p-4 md:p-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default AdminLayout;
