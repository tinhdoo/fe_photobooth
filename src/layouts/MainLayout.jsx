import { useWorkflow } from '../context/WorkflowContext';
import SessionTimer from '../components/common/SessionTimer';

const MainLayout = ({ children }) => {
    const { currentStep, resetSession } = useWorkflow();


    return (
        <div className="relative w-screen h-screen bg-[#F9FAF7] overflow-hidden flex flex-col font-serif text-[#3A403A]">

            {/* Session Timer Overlay */}
            <SessionTimer />

            {/* Main Content Area */}
            <main className="flex-1 w-full h-full relative">
                {children}
            </main>


        </div>
    );
};

export default MainLayout;
