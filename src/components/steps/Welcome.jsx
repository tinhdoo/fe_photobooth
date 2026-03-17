import { useWorkflow } from '../../context/WorkflowContext';

const Welcome = () => {
    const { nextStep } = useWorkflow();

    return (
        <div
            className="w-full h-full flex flex-col items-center justify-center cursor-pointer relative overflow-hidden"
            onClick={nextStep}
        >
            {/* Background Image Only */}
            <div
                className="absolute inset-0 bg-cover bg-center z-0"
                style={{ backgroundImage: "url('/1.png')" }}
            />
        </div>
    );
};

export default Welcome;
