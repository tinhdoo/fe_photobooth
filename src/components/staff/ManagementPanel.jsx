import { Suspense, lazy, useState } from 'react';
import { Printer, Settings, X, Banknote, Zap, DollarSign, Minimize2, Power, Home, Wrench } from 'lucide-react';
import StaffPanel from './StaffPanel';
import { useWorkflow } from '../../context/WorkflowContext';
import { API_URL } from '../../config/api';

const SettingsPanel = lazy(() => import('../admin/Settings'));
const BillSettingsPanel = lazy(() => import('../admin/BillSettings'));

const tabs = [
    { id: 'prints', label: 'In lại / In thêm', icon: Printer },
    { id: 'settings', label: 'Cài đặt local', icon: Settings },
    { id: 'bill', label: 'Máy đọc tiền', icon: Banknote },
];

const ManagementPanel = ({ onClose }) => {
    const [activeTab, setActiveTab] = useState('prints');
    const [confirmExit, setConfirmExit] = useState(false);
    const [confirmShutdown, setConfirmShutdown] = useState(false);
    const [confirmHome, setConfirmHome] = useState(false);
    const { isEventMode, toggleEventMode, currentStep, resetSession } = useWorkflow();

    const activeLabel = tabs.find((t) => t.id === activeTab)?.label ?? '';

    // Thoát kiosk: backend mở lại Chrome ở cửa sổ thường rồi thu nhỏ -> staff dùng được Windows,
    // booth vẫn chạy nền, phục hồi cửa sổ là chụp tiếp. Xác nhận 2 bước.
    const handleExitKiosk = () => {
        if (!confirmExit) {
            setConfirmExit(true);
            setTimeout(() => setConfirmExit(false), 4000);
            return;
        }
        fetch(`${API_URL}/api/kiosk/windowed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: window.location.origin }),
        }).catch(() => {});
    };

    // Tắt phần mềm: đóng trình duyệt RỒI tắt hẳn backend + Canon middleware (backend chạy
    // tools/stop_photobooth.ps1) cho máy sạch. Mở lại bằng TomatoPhotobooth.exe. Xác nhận 2 bước.
    const handleShutdown = () => {
        if (!confirmShutdown) {
            setConfirmShutdown(true);
            setTimeout(() => setConfirmShutdown(false), 4000);
            return;
        }
        fetch(`${API_URL}/api/kiosk/exit`, { method: 'POST' }).catch(() => {});
    };

    // Về màn chủ: HỦY phiên đang chạy (kể cả khi kẹt/lỗi giữa lúc chụp) -> reset + reload về Welcome.
    // Chỉ hiện khi KHÔNG ở màn chủ (currentStep > 1). Xác nhận 2 bước để tránh mất phiên do lỡ tay.
    const handleGoHome = () => {
        if (!confirmHome) {
            setConfirmHome(true);
            setTimeout(() => setConfirmHome(false), 4000);
            return;
        }
        resetSession();
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1a1410]/55 p-4 font-sans backdrop-blur-md sm:p-6"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
        >
            <div className="flex h-[92vh] w-full max-w-7xl overflow-hidden rounded-[28px] bg-white shadow-[0_30px_80px_-20px_rgba(60,40,20,0.45)] ring-1 ring-black/5">
                {/* ───────── SIDEBAR ───────── */}
                <aside className="flex w-64 shrink-0 flex-col border-r border-black/[0.06] bg-[#F7F2EA]">
                    {/* Thương hiệu */}
                    <div className="flex items-center gap-3 px-5 pb-4 pt-5">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#A67C52] to-[#6F543B] text-white shadow-md shadow-[#7B5E43]/30">
                            <Wrench size={19} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="truncate text-[15px] font-black leading-tight text-[#3f342a]">Quản lý máy</h2>
                            <p className="truncate text-[11px] font-semibold text-[#a1917d]">Cấu hình &amp; vận hành</p>
                        </div>
                    </div>

                    {/* Điều hướng */}
                    <nav className="flex-1 space-y-1 px-3 py-2">
                        <p className="px-3 pb-1 pt-2 text-[10px] font-black uppercase tracking-wider text-[#bcaa92]">Chức năng</p>
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            const active = activeTab === tab.id;

                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`group flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-bold transition-all ${active
                                        ? 'bg-gradient-to-r from-[#987351] to-[#7B5E43] text-white shadow-md shadow-[#7B5E43]/25'
                                        : 'text-[#6b5744] hover:bg-[#987351]/10'}`}
                                >
                                    <Icon size={18} className={active ? 'text-white' : 'text-[#a1917d] group-hover:text-[#7B5E43]'} />
                                    <span className="truncate">{tab.label}</span>
                                </button>
                            );
                        })}
                    </nav>

                    {/* Hành động hệ thống */}
                    <div className="space-y-1 border-t border-black/[0.06] px-3 py-3">
                        <p className="px-3 pb-1 text-[10px] font-black uppercase tracking-wider text-[#bcaa92]">Hệ thống</p>

                        {currentStep > 1 && (
                            <button
                                type="button"
                                onClick={handleGoHome}
                                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-bold transition-all ${confirmHome
                                    ? 'animate-pulse bg-[#b45309] text-white shadow-sm'
                                    : 'text-[#6b5744] hover:bg-[#987351]/10'}`}
                            >
                                <Home size={18} className={confirmHome ? 'text-white' : 'text-[#a1917d]'} />
                                <span className="truncate">{confirmHome ? 'Xác nhận huỷ phiên?' : 'Về màn chủ'}</span>
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={handleExitKiosk}
                            className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-bold transition-all ${confirmExit
                                ? 'animate-pulse bg-[#b45309] text-white shadow-sm'
                                : 'text-[#6b5744] hover:bg-[#987351]/10'}`}
                        >
                            <Minimize2 size={18} className={confirmExit ? 'text-white' : 'text-[#a1917d]'} />
                            <span className="truncate">{confirmExit ? 'Xác nhận thu nhỏ?' : 'Thu nhỏ màn hình'}</span>
                        </button>

                        <button
                            type="button"
                            onClick={handleShutdown}
                            className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-bold transition-all ${confirmShutdown
                                ? 'animate-pulse bg-[#e63946] text-white shadow-md shadow-[#e63946]/30'
                                : 'text-[#d33a48] hover:bg-[#e63946]/10'}`}
                        >
                            <Power size={18} className={confirmShutdown ? 'text-white' : 'text-[#e05563]'} />
                            <span className="truncate">{confirmShutdown ? 'Tắt hẳn phần mềm?' : 'Tắt phần mềm'}</span>
                        </button>
                    </div>
                </aside>

                {/* ───────── VÙNG CHÍNH ───────── */}
                <div className="flex min-w-0 flex-1 flex-col bg-[#FCFAF5]">
                    {/* Thanh trên: breadcrumb + chế độ + đóng */}
                    <header className="flex items-center justify-between gap-4 border-b border-black/[0.06] bg-white/80 px-6 py-3.5 backdrop-blur">
                        <div className="flex min-w-0 items-center gap-2 text-sm">
                            <span className="font-semibold text-[#a1917d]">Quản lý máy</span>
                            <span className="text-[#dccdb6]">/</span>
                            <span className="truncate font-black text-[#3f342a]">{activeLabel}</span>
                        </div>

                        <div className="flex shrink-0 items-center gap-3">
                            <button
                                type="button"
                                onClick={toggleEventMode}
                                title="Đổi chế độ tính tiền"
                                className="flex items-center gap-2 rounded-full border border-black/[0.08] bg-white px-3.5 py-2 text-sm font-bold text-[#3f342a] shadow-sm transition-colors hover:bg-[#faf6ef]"
                            >
                                <span className={`h-2 w-2 rounded-full ${isEventMode ? 'bg-[#e63946]' : 'bg-emerald-500'}`} />
                                <span className="hidden sm:inline text-[#8a7d6d]">Chế độ:</span>
                                {isEventMode ? 'Sự kiện' : 'Trả phí'}
                                {isEventMode ? <Zap size={15} className="text-[#e63946]" /> : <DollarSign size={15} className="text-emerald-600" />}
                            </button>

                            <button
                                type="button"
                                onClick={onClose}
                                className="rounded-full border border-black/[0.08] bg-white p-2.5 text-[#7B5E43] shadow-sm transition-colors hover:bg-[#faf6ef]"
                                aria-label="Đóng"
                            >
                                <X size={20} />
                            </button>
                        </div>
                    </header>

                    {/* Nội dung */}
                    <div className="min-h-0 flex-1 overflow-auto">
                        {activeTab === 'prints' ? (
                            <StaffPanel embedded />
                        ) : activeTab === 'bill' ? (
                            <div className="p-6">
                                <Suspense fallback={(
                                    <div className="rounded-2xl border border-black/[0.06] bg-white p-10 text-center font-black text-[#7B5E43] shadow-sm">
                                        Đang tải cài đặt máy đọc tiền...
                                    </div>
                                )}>
                                    <BillSettingsPanel forceLocalAdmin={true} />
                                </Suspense>
                            </div>
                        ) : (
                            <div className="p-6">
                                <Suspense fallback={(
                                    <div className="rounded-2xl border border-black/[0.06] bg-white p-10 text-center font-black text-[#7B5E43] shadow-sm">
                                        Đang tải cài đặt...
                                    </div>
                                )}>
                                    <SettingsPanel forceLocalAdmin={true} />
                                </Suspense>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManagementPanel;
