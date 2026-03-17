import React from 'react';
import { useWorkflow } from '../../context/WorkflowContext';
import { Settings, Zap, DollarSign } from 'lucide-react';

const BoothConfig = () => {
    const { isEventMode, toggleEventMode } = useWorkflow();

    return (
        <div className="space-y-8 animate-fadeIn">
            <h1 className="text-3xl text-[#2f3e46] font-bold">Cấu hình Booth</h1>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 max-w-2xl">
                <div className="flex items-start gap-6">
                    <div className={`p-4 rounded-full ${isEventMode ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                        <Settings size={32} />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-2xl font-bold text-[#2f3e46] mb-2">Chế độ Hoạt động</h2>
                        <p className="text-gray-500 mb-6">
                            Chọn chế độ hoạt động cho thiết bị này.
                            Cài đặt được lưu trên máy.
                        </p>

                        <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                            <button
                                onClick={() => !isEventMode && toggleEventMode()}
                                className={`flex-1 p-4 rounded-lg border-2 transition-all flex flex-col items-center gap-2 ${isEventMode
                                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                                    : 'border-transparent hover:bg-gray-100 text-gray-500'
                                    }`}
                            >
                                <Zap size={24} />
                                <span className="font-bold">Sự kiện (Miễn phí)</span>
                                <span className="text-xs">Bỏ qua thanh toán</span>
                            </button>

                            <button
                                onClick={() => isEventMode && toggleEventMode()}
                                className={`flex-1 p-4 rounded-lg border-2 transition-all flex flex-col items-center gap-2 ${!isEventMode
                                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                                    : 'border-transparent hover:bg-gray-100 text-gray-500'
                                    }`}
                            >
                                <DollarSign size={24} />
                                <span className="font-bold">Dịch vụ (Trả phí)</span>
                                <span className="text-xs">Yêu cầu thanh toán</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BoothConfig;
