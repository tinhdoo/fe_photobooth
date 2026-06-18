import { useWorkflow } from '../context/WorkflowContext';
import SessionTimer from '../components/common/SessionTimer';

const MainLayout = ({ children }) => {
    const { currentStep, resetSession } = useWorkflow();
    void currentStep;
    void resetSession;

    return (
        <div className="relative w-screen h-screen bg-[#FFF8E7] overflow-hidden flex flex-col font-serif text-[#3F3127]">
            <SessionTimer />
            <main className="flex-1 w-full h-full relative">
                {children}
            </main>
        </div>
    );
};

export default MainLayout;
