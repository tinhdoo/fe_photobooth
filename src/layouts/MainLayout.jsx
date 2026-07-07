import { useWorkflow } from '../context/WorkflowContext';
import SessionTimer from '../components/common/SessionTimer';
import StaffEscape from '../components/staff/StaffEscape';

const MainLayout = ({ children }) => {
    const { currentStep, savingBeforeReset } = useWorkflow();
    void currentStep;

    return (
        <div className="relative w-screen h-screen bg-[#FFF8E7] overflow-hidden flex flex-col font-serif text-[#3F3127]">
            <SessionTimer />
            {/* Cổng thoát nhân viên: nhấn giữ 3s góc phải trên -> PIN -> Quản lý máy / Về màn chủ.
                Khả dụng ở mọi bước để gỡ khi phiên kẹt giữa lúc chụp. */}
            <StaffEscape />
            <main className="flex-1 w-full h-full relative">
                {children}
            </main>

            {/* Chờ lưu nốt ảnh gốc/video ở nền trước khi về trang chủ -> không mất ảnh. */}
            {savingBeforeReset && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#FFF8E7]/95 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-4">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#D5B895] border-t-transparent" />
                        <p className="text-xl font-extrabold text-[#7B5E43]">Đang lưu ảnh...</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MainLayout;
