import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useWorkflow } from '../../context/WorkflowContext';

const PrintQuantity = () => {
    const { nextStep, prevStep, sessionData, updateSessionData, configs } = useWorkflow();
    const layout = sessionData.layout || {};
    const isUploadFlow = sessionData.source === 'upload';

    const BASE_PRICE = isUploadFlow
        ? parseInt(configs?.mobile_price || 30000)
        : parseInt(configs?.price || 60000);

    const INCREMENT = isUploadFlow
        ? parseInt(configs?.mobile_print_price || 10000)
        : parseInt(configs?.print_price || 20000);

    // Determine quantities and pricing based on layout
    const getQuantityOptions = () => {
        // ... existing logic ...
        const isStripLayout = layout.type === 'strip' || layout.id?.includes('cut');

        if (isStripLayout) {
            // Strip/Cut layouts: 2, 4, 6, 8, 10
            // Base price is for the minimum set (2 strips)
            return [
                { qty: 2, price: BASE_PRICE },
                { qty: 4, price: BASE_PRICE + INCREMENT },
                { qty: 6, price: BASE_PRICE + (INCREMENT * 2) },
                { qty: 8, price: BASE_PRICE + (INCREMENT * 3) },
                { qty: 10, price: BASE_PRICE + (INCREMENT * 4) },
            ];
        } else {
            // Standard layouts: 1, 2, 3, 4, 5
            return [
                { qty: 1, price: BASE_PRICE },
                { qty: 2, price: BASE_PRICE + INCREMENT },
                { qty: 3, price: BASE_PRICE + (INCREMENT * 2) },
                { qty: 4, price: BASE_PRICE + (INCREMENT * 3) },
                { qty: 5, price: BASE_PRICE + (INCREMENT * 4) },
            ];
        }
    };

    const options = getQuantityOptions();
    const [selectedOption, setSelectedOption] = useState(options[0]);

    const handleConfirm = () => {
        updateSessionData('printQuantity', selectedOption.qty);
        updateSessionData('printPrice', selectedOption.price);
        nextStep();
    };

    return (
        <div className="flex flex-col items-center justify-center h-full w-full p-8 bg-[#F9FAF7] relative">
            {/* Back Button */}
            <button
                onClick={prevStep}
                className="absolute top-6 left-6 flex items-center gap-2 px-6 py-3 bg-white hover:bg-gray-50 text-[#52796f] rounded-full transition-all font-serif font-bold shadow-sm hover:shadow-md border border-[#A8B5A0]/20 z-10"
            >
                <ArrowLeft size={24} />
                <span>Quay Lại</span>
            </button>
            <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-5xl font-serif text-[#52796f] text-center mb-12 tracking-wider uppercase"
            >
                Chọn số lượng bản in
            </motion.h2>

            <div className="flex gap-6 mb-12">
                {options.map((option, index) => (
                    <motion.button
                        key={option.qty}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setSelectedOption(option)}
                        className={`
                            w-32 h-32 rounded-lg flex flex-col items-center justify-center
                            transition-all duration-200 shadow-lg
                            ${selectedOption.qty === option.qty
                                ? 'bg-[#A8B5A0] text-white scale-105'
                                : 'bg-[#CAD2C5] text-[#52796f] hover:bg-[#A8B5A0] hover:text-white'
                            }
                        `}
                    >
                        <div className="text-5xl font-bold font-serif">{option.qty}</div>
                    </motion.button>
                ))}
            </div>

            {/* Price Display */}
            <div className="mb-8 text-center">
                <p className="text-2xl text-[#52796f] font-serif">
                    {selectedOption.qty} {selectedOption.qty === 1 ? 'bản in' : 'bản in'}
                </p>
                <p className="text-3xl font-bold text-[#354f52] mt-2">
                    {selectedOption.price.toLocaleString()}₫
                </p>
            </div>

            {/* Confirm Button */}
            <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleConfirm}
                className="bg-[#A8B5A0] text-white px-12 py-4 rounded-full text-xl font-bold shadow-lg hover:bg-[#84a98c] transition-all"
            >
                Xác nhận
            </motion.button>
        </div>
    );
};

export default PrintQuantity;
