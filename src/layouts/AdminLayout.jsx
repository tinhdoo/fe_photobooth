import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Layout, DollarSign, TrendingUp, Settings, Banknote, Menu, X, LogOut, Palette } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkflow } from '../context/WorkflowContext';
import { isLocalHost } from '../utils/runtime';

const BrandHeader = ({ compact = false, logoUrl = '/logo_tomato.png' }) => (
    <div className="flex items-center gap-3">
        <img
            src={logoUrl}
            alt="Tomato Photobooth"
            className={`${compact ? 'h-9 w-9' : 'h-11 w-11'} rounded-full object-contain`}
        />
        <div>
            <h1 className={`font-serif font-extrabold leading-tight text-[#2f3e46] ${compact ? 'text-lg' : 'text-xl'}`}>
                Tomato Photobooth
            </h1>
            {!compact && <p className="text-xs font-semibold text-[#52796f]/75">Admin</p>}
        </div>
    </div>
);

const AdminLayout = () => {
    const location = useLocation();
    const { configs } = useWorkflow();
    const logoUrl = configs?.logo_main || '/logo_tomato.png';
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
    const closeSidebar = () => setIsSidebarOpen(false);

    const menuItems = [
        { to: '/admin/codes', icon: <DollarSign size={20} />, label: 'Mã thanh toán' },
        { to: '/admin', icon: <Layout size={20} />, label: 'Khung hình' },
        { to: '/admin/revenue', icon: <TrendingUp size={20} />, label: 'Doanh thu' },
        { to: '/admin/bill-settings', icon: <Banknote size={20} />, label: 'Đầu đọc tiền' },
        { to: '/admin/branding', icon: <Palette size={20} />, label: 'Giao diện & Branding' },
        { to: '/admin/settings', icon: <Settings size={20} />, label: 'Cài đặt' },
    ].filter((item) => (
        isLocalHost()
            ? ['/admin/settings', '/admin/bill-settings'].includes(item.to)
            : item.to !== '/admin/bill-settings'
    ));

    return (
        <div className="flex h-screen bg-[#F0F2E9]">
            <div className="fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6 lg:hidden">
                <BrandHeader compact logoUrl={logoUrl} />
                <button
                    type="button"
                    onClick={toggleSidebar}
                    className="rounded-lg p-2 text-[#52796f] transition-colors hover:bg-gray-100"
                    aria-label="Mở menu"
                >
                    {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
            </div>

            <AnimatePresence>
                {isSidebarOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={closeSidebar}
                        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
                    />
                )}
            </AnimatePresence>

            <div
                className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gray-200 bg-white transition-transform duration-300 ease-in-out lg:relative ${
                    isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
                }`}
            >
                <div className="hidden border-b border-gray-100 p-6 lg:block">
                    <BrandHeader logoUrl={logoUrl} />
                </div>

                <div className="flex items-center justify-between border-b border-gray-100 p-6 lg:hidden">
                    <BrandHeader compact logoUrl={logoUrl} />
                    <button type="button" onClick={closeSidebar} className="p-2 text-gray-400" aria-label="Đóng menu">
                        <X size={20} />
                    </button>
                </div>

                <nav className="flex-1 space-y-2 overflow-y-auto p-4">
                    {menuItems.map((item) => (
                        <Link
                            key={item.to}
                            to={item.to}
                            onClick={closeSidebar}
                            className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-colors ${
                                location.pathname === item.to
                                    ? 'bg-[#A8B5A0] text-white'
                                    : 'text-[#52796f] hover:bg-[#F9FAF7]'
                            }`}
                        >
                            {item.icon}
                            <span className="font-medium">{item.label}</span>
                        </Link>
                    ))}
                    <button
                        type="button"
                        onClick={() => {
                            localStorage.removeItem('isAuthenticated');
                            sessionStorage.removeItem('isAuthenticated');
                            window.location.href = '/admin/login';
                        }}
                        className="mt-8 flex w-full items-center justify-start gap-3 rounded-xl border-t border-gray-50 px-4 py-3 pt-8 text-[#e63946] transition-colors hover:bg-red-50"
                    >
                        <LogOut size={20} />
                        <span className="font-medium">Đăng xuất</span>
                    </button>
                </nav>

                <div className="border-t border-gray-100 p-6 text-xs text-gray-400">v1.0.0</div>
            </div>

            <div className="flex-1 overflow-auto pt-16 lg:pt-0">
                <main className="p-4 md:p-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default AdminLayout;
