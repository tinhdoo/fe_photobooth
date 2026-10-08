import { useWorkflow } from '../context/WorkflowContext';
import SessionTimer from '../components/common/SessionTimer';
import StaffEscape from '../components/staff/StaffEscape';

const MainLayout = ({ children }) => {
    const { currentStep, savingBeforeReset, isIdleSuspended, wakeFromIdle, idleWarning } = useWorkflow();
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

            {/* Khách bỏ ngang trước khi vào lượt (WorkflowContext): đếm ngược rồi tự về trang chủ. Chạm bất kỳ
                đâu là ở lại; lớp phủ nuốt cú chạm đó để không bấm nhầm nút bên dưới. */}
            {idleWarning != null && (
                <div
                    className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 px-6 backdrop-blur-sm"
                    style={{ touchAction: 'none' }}
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-3xl bg-[#FFF8E7] p-8 text-center shadow-2xl">
                        <p className="text-2xl font-extrabold text-[#7B5E43]">Bạn còn ở đây không?</p>
                        <p className="text-base font-bold text-[#5E6B78]">Màn hình sẽ tự về trang chủ sau</p>
                        <p className="text-6xl font-black tabular-nums text-[#7B5E43]">{idleWarning}</p>
                        <span className="mt-2 rounded-full bg-[#7B5E43] px-8 py-3 text-lg font-extrabold text-white">
                            Chạm để tiếp tục
                        </span>
                    </div>
                </div>
            )}

            {/* Màn chờ khi booth rảnh quá lâu: nền đen tuyền (không animation, không video) để
                Chrome nhả power request -> Windows tự ngủ theo power plan. Lớp phủ này NUỐT cú
                chạm đầu tiên: khách chạm chỉ để đánh thức, không vô tình bấm vào nút bên dưới. */}
            {isIdleSuspended && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black"
                    style={{ touchAction: 'none' }}
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); wakeFromIdle(); }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Chữ tĩnh, KHÔNG animation: máy vừa thức dậy mà thấy đen thui thì khách tưởng
                        hỏng. Tĩnh nên không giữ máy thức như video/animation. */}
                    <span className="text-2xl font-bold text-white/25">Chạm để bắt đầu</span>
                </div>
            )}
        </div>
    );
};

export default MainLayout;
