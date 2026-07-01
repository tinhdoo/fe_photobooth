import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Layout, DollarSign, TrendingUp, Settings, Banknote, LogOut, Palette, PlusCircle } from 'lucide-react';
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
            <h1 className={`font-serif font-extrabold leading-tight text-[#1a1a2e] ${compact ? 'text-lg' : 'text-xl'}`}>
                Tomato Photobooth
            </h1>
            {!compact && <p className="text-xs font-semibold text-[#e63946]/75">Admin</p>}
        </div>
    </div>
);

const AdminLayout = () => {
    const location = useLocation();
    const { configs } = useWorkflow();
    const logoUrl = configs?.logo_main || '/logo_tomato.png';

    const menuItems = [
        { to: '/admin/codes', icon: <DollarSign size={22} />, label: 'Mã thanh toán', short: 'Mã TT' },
        { to: '/admin', icon: <Layout size={22} />, label: 'Frame', short: 'Frame' },
        { to: '/admin/revenue', icon: <TrendingUp size={22} />, label: 'Doanh thu', short: 'Doanh thu' },
        { to: '/admin/branding', icon: <Palette size={22} />, label: 'Giao diện', short: 'Giao diện' },
        { to: '/admin/settings', icon: <Settings size={22} />, label: 'Cài đặt', short: 'Cài đặt' },
    ].filter((item) => (
        isLocalHost()
            ? ['/admin/settings', '/admin/bill-settings'].includes(item.to)
            : item.to !== '/admin/bill-settings'
    ));

    // For bottom nav on mobile, pick the most important 4 items (which now starts with Codes)
    const mobileNavItems = menuItems.filter(item => item.to !== '/admin/settings');

    const isActive = (to) => {
        if (to === '/admin') return location.pathname === '/admin';
        return location.pathname.startsWith(to);
    };

    return (
        <div className="flex h-[100dvh] bg-gray-50 overflow-hidden">
            {/* Desktop Sidebar */}
            <div className="hidden lg:flex w-64 flex-col border-r border-gray-100 bg-white">
                <div className="border-b border-gray-100 p-6">
                    <BrandHeader logoUrl={logoUrl} />
                </div>

                <nav className="flex-1 space-y-1 overflow-y-auto p-4">
                    {menuItems.map((item) => (
                        <Link
                            key={item.to}
                            to={item.to}
                            className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200 ${
                                isActive(item.to)
                                    ? 'bg-[#e63946] text-white shadow-md shadow-[#e63946]/20'
                                    : 'text-gray-500 hover:bg-gray-50 hover:text-[#e63946]'
                            }`}
                        >
                            {item.icon}
                            <span className="font-semibold text-sm">{item.label}</span>
                        </Link>
                    ))}

                    {/* Bill settings for local only */}
                    {isLocalHost() && (
                        <Link
                            to="/admin/bill-settings"
                            className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200 ${
                                isActive('/admin/bill-settings')
                                    ? 'bg-[#e63946] text-white shadow-md shadow-[#e63946]/20'
                                    : 'text-gray-500 hover:bg-gray-50 hover:text-[#e63946]'
                            }`}
                        >
                            <Banknote size={22} />
                            <span className="font-semibold text-sm">Đầu đọc tiền</span>
                        </Link>
                    )}

                    <button
                        type="button"
                        onClick={() => {
                            localStorage.removeItem('isAuthenticated');
                            sessionStorage.removeItem('isAuthenticated');
                            window.location.href = '/admin/login';
                        }}
                        className="mt-6 flex w-full items-center justify-start gap-3 rounded-xl px-4 py-3 text-gray-400 transition-all hover:bg-red-50 hover:text-[#e63946]"
                    >
                        <LogOut size={20} />
                        <span className="font-medium text-sm">Đăng xuất</span>
                    </button>
                </nav>

                <div className="border-t border-gray-100 p-6 text-xs text-gray-300">v1.0.0</div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Mobile Top Bar */}
                <div className="lg:hidden flex items-center justify-between px-5 py-3 bg-white border-b border-gray-100">
                    <BrandHeader compact logoUrl={logoUrl} />
                    <button
                        type="button"
                        onClick={() => {
                            localStorage.removeItem('isAuthenticated');
                            sessionStorage.removeItem('isAuthenticated');
                            window.location.href = '/admin/login';
                        }}
                        className="p-2 text-gray-400 hover:text-[#e63946] rounded-lg hover:bg-red-50 transition-colors"
                        title="Đăng xuất"
                    >
                        <LogOut size={20} />
                    </button>
                </div>

                {/* Content Area — đệm dưới đủ để nút cuối (vd Lưu) vượt qua thanh nav fixed + safe-area */}
                <div
                    className="flex-1 overflow-y-auto overflow-x-hidden pb-[calc(env(safe-area-inset-bottom)+6.5rem)] lg:pb-0"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                >
                    <main className="p-4 md:p-8 w-full max-w-full overflow-x-hidden box-border">
                        <Outlet />
                    </main>
                </div>

                {/* Mobile Bottom Navigation */}
                <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 shadow-[0_-4px_20px_-4px_rgba(0,0,0,0.08)]">
                    <nav className="flex items-stretch px-1 py-1">
                        {mobileNavItems.map((item) => {
                            const active = isActive(item.to);
                            return (
                                <Link
                                    key={item.to}
                                    to={item.to}
                                    className={`flex flex-1 flex-col items-center justify-start gap-0.5 px-0.5 py-2 rounded-xl transition-all duration-200 ${
                                        active ? 'text-[#e63946]' : 'text-gray-400 active:text-[#e63946]'
                                    }`}
                                >
                                    <div className={`transition-transform duration-200 ${active ? 'scale-110' : ''}`}>
                                        {item.icon}
                                    </div>
                                    <span className={`whitespace-nowrap text-[10px] font-bold leading-tight ${active ? 'text-[#e63946]' : 'text-gray-400'}`}>
                                        {item.short || item.label}
                                    </span>
                                </Link>
                            );
                        })}
                        {/* Settings (always last in bottom nav) */}
                        <Link
                            to="/admin/settings"
                            className={`flex flex-1 flex-col items-center justify-start gap-0.5 px-0.5 py-2 rounded-xl transition-all duration-200 ${
                                isActive('/admin/settings') ? 'text-[#e63946]' : 'text-gray-400 active:text-[#e63946]'
                            }`}
                        >
                            <div className={`transition-transform duration-200 ${isActive('/admin/settings') ? 'scale-110' : ''}`}>
                                <Settings size={22} />
                            </div>
                            <span className={`whitespace-nowrap text-[10px] font-bold leading-tight ${isActive('/admin/settings') ? 'text-[#e63946]' : 'text-gray-400'}`}>
                                Cài đặt
                            </span>
                        </Link>
                    </nav>
                    {/* Safe area for devices with home indicator */}
                    <div className="h-[env(safe-area-inset-bottom,0px)] bg-white" />
                </div>
            </div>
        </div>
    );
};

export default AdminLayout;
