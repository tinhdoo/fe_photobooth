import { useWorkflow } from '../../context/WorkflowContext';
import { Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SessionTimer = () => {
    const { timeLeft, isSessionActive, currentStep } = useWorkflow();

    // Only show timer in active steps (Capture, Review, Edit)
    // Step 4 = Capture, 5 = Review, 6 = Edit
    const shouldShow = isSessionActive && currentStep >= 4 && currentStep <= 6;

    if (!shouldShow) return null;

    // Formatting mm:ss
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    const isCritical = timeLeft < 60; // Red alert for last minute

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={`
                    fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-2 rounded-full shadow-lg border-2
                    ${isCritical
                        ? 'bg-red-50 border-red-200 text-red-600 animate-pulse'
                        : 'bg-white/90 border-[#A8B5A0]/30 text-[#52796f]'}
                    backdrop-blur-sm font-serif font-bold transition-colors duration-300
                `}
            >
                <Clock size={20} className={isCritical ? 'animate-bounce' : ''} />
                <span className="text-xl tabular-nums">
                    {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
                </span>
            </motion.div>
        </AnimatePresence>
    );
};

export default SessionTimer;
