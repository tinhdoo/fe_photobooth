import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useWorkflow } from '../../context/WorkflowContext';
import { getCurrentPricing } from '../../utils/pricing';

const PrintQuantity = () => {
    const { nextStep, prevStep, sessionData, updateSessionData, configs } = useWorkflow();
    const layout = sessionData.layout || {};
    const isUploadFlow = sessionData.source === 'upload';

    const pricing = getCurrentPricing(configs);
    const basePrice = isUploadFlow ? pricing.mobile_price : pricing.price;
    const increment = isUploadFlow ? pricing.mobile_print_price : pricing.print_price;
    const primaryTextColor = configs?.brand_text_primary || '#7B5E43';
    const secondaryTextColor = configs?.brand_text_secondary || '#5E6B78';

    const isStripLayout = layout.type === 'strip' || layout.id?.includes('cut');
    const quantities = isStripLayout ? [2, 4, 6, 8, 10] : [1, 2, 3, 4, 5];
    const options = quantities.map((qty, index) => ({ qty, price: basePrice + increment * index }));
    const [selectedOption, setSelectedOption] = useState(options[0]);

    const handleConfirm = () => {
        updateSessionData('printQuantity', selectedOption.qty);
        updateSessionData('printPrice', selectedOption.price);
        nextStep();
    };

    return (
        <div
            className="relative flex h-full w-full flex-col items-center justify-center bg-[#FFF8E7] bg-cover bg-center p-8 font-serif"
            style={{ backgroundImage: configs?.['bg_select-photo-number'] ? `url('${configs['bg_select-photo-number']}')` : 'none' }}
        >
            <button
                type="button"
                onClick={prevStep}
                className="absolute left-6 top-6 z-10 flex items-center gap-2 rounded-full bg-white/80 px-6 py-3 font-bold shadow-sm backdrop-blur transition-none active:scale-95"
                style={{ color: primaryTextColor }}
            >
                <ArrowLeft size={24} />
                <span>Quay lại</span>
            </button>

            <h2 className="mb-12 text-center text-5xl font-bold uppercase tracking-wide" style={{ color: primaryTextColor }}>
                Chọn số lượng bản in
            </h2>

            <div className="mb-12 flex gap-6">
                {options.map((option) => (
                    <button
                        type="button"
                        key={option.qty}
                        onClick={() => setSelectedOption(option)}
                        className={`flex h-32 w-32 items-center justify-center rounded-3xl text-5xl font-bold shadow-lg transition-all ${
                            selectedOption.qty === option.qty
                                ? 'scale-110 bg-[#D5B895] text-white'
                                : 'bg-[#F6E6C9]'
                        }`}
                        style={selectedOption.qty === option.qty ? undefined : { color: primaryTextColor }}
                    >
                        {option.qty}
                    </button>
                ))}
            </div>

            <div className="mb-8 rounded-3xl bg-white/90 px-10 py-6 text-center shadow-md">
                <p className="text-2xl font-bold" style={{ color: primaryTextColor }}>{selectedOption.qty} bản in</p>
                <p className="mt-2 text-3xl font-bold" style={{ color: secondaryTextColor }}>
                    {selectedOption.price.toLocaleString('vi-VN')} VNĐ
                </p>
            </div>

            <button
                type="button"
                onClick={handleConfirm}
                className="rounded-full bg-[#D5B895] px-12 py-4 text-xl font-bold text-white shadow-lg transition-none active:scale-95"
            >
                Xác nhận
            </button>
        </div>
    );
};

export default PrintQuantity;
