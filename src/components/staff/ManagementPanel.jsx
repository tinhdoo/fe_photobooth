import { Suspense, lazy, useState } from 'react';
import { Printer, Settings, X, Banknote, Zap, DollarSign, LogOut } from 'lucide-react';
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
    const { isEventMode, toggleEventMode } = useWorkflow();

    // Thoát kiosk: đóng trình duyệt kiosk (backend chạy taskkill chrome/edge) để staff về màn hình
    // Windows. Xác nhận 2 bước (bấm lần 1 -> "Xác nhận thoát?", lần 2 mới thoát).
    const handleExitKiosk = () => {
        if (!confirmExit) {
            setConfirmExit(true);
            setTimeout(() => setConfirmExit(false), 4000);
            return;
        }
        fetch(`${API_URL}/api/kiosk/exit`, { method: 'POST' }).catch(() => {});
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-5 font-sans"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
        >
            <div className="flex h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-gray-100 bg-[#FFFDF2] shadow-2xl">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 bg-white px-6 py-4">
                    <div>
                        <h2 className="text-2xl font-black text-[#1a1a2e]">Quản lý máy</h2>
                        <p className="text-sm font-semibold text-[#7B5E43]">In lại, in thêm và cấu hình local</p>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={toggleEventMode}
                            className={`flex items-center gap-2 rounded-full px-4 py-2 font-black transition-colors shadow-sm ${
                                isEventMode
                                    ? 'bg-[#e63946] text-white hover:bg-[#c1121f]'
                                    : 'bg-[#987351] text-white hover:bg-[#7B5E43]'
                            }`}
                        >
                            {isEventMode ? (
                                <>Sự kiện <Zap size={18} /></>
                            ) : (
                                <>Trả phí <DollarSign size={18} /></>
                            )}
                        </button>

                        <div className="flex rounded-full border border-gray-200 bg-white p-1">
                            {tabs.map((tab) => {
                                const Icon = tab.icon;
                                const active = activeTab === tab.id;

                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black transition-colors ${active
                                            ? 'bg-[#987351] text-white shadow-sm'
                                            : 'text-[#7B5E43] hover:bg-[#FFFDF2]'}`}
                                    >
                                        <Icon size={18} />
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>

                        <button
                            type="button"
                            onClick={handleExitKiosk}
                            className={`flex items-center gap-2 rounded-full px-4 py-2 font-black text-white shadow-sm transition-colors ${confirmExit ? 'bg-[#c1121f] animate-pulse' : 'bg-[#e63946] hover:bg-[#c1121f]'}`}
                        >
                            <LogOut size={18} />
                            {confirmExit ? 'Xác nhận thoát?' : 'Thoát kiosk'}
                        </button>

                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-full bg-[#987351] p-3 text-white transition-colors hover:bg-[#7B5E43]"
                            aria-label="Đóng"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                    {activeTab === 'prints' ? (
                        <StaffPanel embedded />
                    ) : activeTab === 'bill' ? (
                        <div className="p-6">
                            <Suspense fallback={(
                                <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center font-black text-[#7B5E43] shadow-sm">
                                    Đang tải cài đặt máy đọc tiền...
                                </div>
                            )}>
                                <BillSettingsPanel forceLocalAdmin={true} />
                            </Suspense>
                        </div>
                    ) : (
                        <div className="p-6">
                            <Suspense fallback={(
                                <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center font-black text-[#7B5E43] shadow-sm">
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
    );
};

export default ManagementPanel;
