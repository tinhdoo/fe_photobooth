import { Suspense, lazy, useState } from 'react';
import { Printer, Settings, X, Banknote, Zap, DollarSign } from 'lucide-react';
import StaffPanel from './StaffPanel';
import { useWorkflow } from '../../context/WorkflowContext';

const SettingsPanel = lazy(() => import('../admin/Settings'));
const BillSettingsPanel = lazy(() => import('../admin/BillSettings'));

const tabs = [
    { id: 'prints', label: 'In lại / In thêm', icon: Printer },
    { id: 'settings', label: 'Cài đặt local', icon: Settings },
    { id: 'bill', label: 'Máy đọc tiền', icon: Banknote },
];

const ManagementPanel = ({ onClose }) => {
    const [activeTab, setActiveTab] = useState('prints');
    const { isEventMode, toggleEventMode } = useWorkflow();

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-5 font-sans"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
        >
            <div className="flex h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-[#E7D3B7] bg-[#FFF8E7] shadow-2xl">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E7D3B7] bg-white px-6 py-4">
                    <div>
                        <h2 className="text-2xl font-black text-[#3F3127]">Quản lý máy</h2>
                        <p className="text-sm font-semibold text-[#7B5E43]">In lại, in thêm và cấu hình local</p>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={toggleEventMode}
                            className={`flex items-center gap-2 rounded-full px-4 py-2 font-black transition-colors ${
                                isEventMode 
                                    ? 'bg-purple-500 text-white hover:bg-purple-600 shadow-sm' 
                                    : 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm'
                            }`}
                        >
                            {isEventMode ? (
                                <>Sự kiện <Zap size={18} /></>
                            ) : (
                                <>Trả phí <DollarSign size={18} /></>
                            )}
                        </button>

                        <div className="flex rounded-full border border-[#E7D3B7] bg-[#FFF8E7] p-1">
                            {tabs.map((tab) => {
                                const Icon = tab.icon;
                                const active = activeTab === tab.id;

                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black transition-colors ${active
                                            ? 'bg-[#8E6B4D] text-white shadow-sm'
                                            : 'text-[#7B5E43]'}`}
                                    >
                                        <Icon size={18} />
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-full bg-[#8E6B4D] p-3 text-white"
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
                                <div className="rounded-3xl bg-white p-10 text-center font-black text-[#7B5E43]">
                                    Đang tải cài đặt máy đọc tiền...
                                </div>
                            )}>
                                <BillSettingsPanel />
                            </Suspense>
                        </div>
                    ) : (
                        <div className="p-6">
                            <Suspense fallback={(
                                <div className="rounded-3xl bg-white p-10 text-center font-black text-[#7B5E43]">
                                    Đang tải cài đặt...
                                </div>
                            )}>
                                <SettingsPanel />
                            </Suspense>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ManagementPanel;
