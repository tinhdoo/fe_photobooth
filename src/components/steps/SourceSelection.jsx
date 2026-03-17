import React from 'react';
import { motion } from 'framer-motion';
import { useWorkflow } from '../../context/WorkflowContext';
import { Camera, Smartphone } from 'lucide-react';

const SourceSelection = () => {
    const { nextStep, updateSessionData } = useWorkflow();

    const handleSelectSource = (source) => {
        updateSessionData('source', source); // 'camera' or 'upload'
        nextStep();
    };

    return (
        <div className="w-full h-full flex flex-col items-center justify-center space-y-8 bg-[#F9FAF7] p-8">
            <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-4xl md:text-5xl font-serif text-[#6A7865] mb-8 text-center drop-shadow-sm"
            >
                Bạn muốn sử dụng ảnh từ đâu?
            </motion.h2>

            <div className="flex flex-col md:flex-row gap-8 w-full max-w-4xl justify-center">

                {/* Option 1: Camera */}
                <motion.div
                    initial={{ opacity: 0, x: -50 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                    className="flex-1 flex"
                >
                    <div
                        onClick={() => handleSelectSource('camera')}
                        className="w-full bg-white rounded-2xl shadow-xl overflow-hidden cursor-pointer group hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 border-2 border-transparent hover:border-[#85937F] flex flex-col"
                    >
                        <div className="h-64 bg-[#B5C1B0] flex items-center justify-center group-hover:bg-[#9BA896] transition-colors duration-300">
                            <Camera size={80} className="text-white drop-shadow-md group-hover:scale-110 transition-transform duration-300" />
                        </div>
                        <div className="p-8 text-center bg-white flex-1">
                            <h3 className="text-2xl font-semibold text-gray-800 mb-2">Chụp tại quầy</h3>
                            <p className="text-gray-500 text-lg">Sử dụng máy ảnh chuyên nghiệp của chúng tôi</p>
                        </div>
                    </div>
                </motion.div>

                {/* Option 2: Phone Upload */}
                <motion.div
                    initial={{ opacity: 0, x: 50 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                    className="flex-1 flex"
                >
                    <div
                        onClick={() => handleSelectSource('upload')}
                        className="w-full bg-white rounded-2xl shadow-xl overflow-hidden cursor-pointer group hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 border-2 border-transparent hover:border-[#85937F] flex flex-col"
                    >
                        <div className="h-64 bg-[#D4C3B3] flex items-center justify-center group-hover:bg-[#C4B3A3] transition-colors duration-300">
                            <Smartphone size={80} className="text-white drop-shadow-md group-hover:scale-110 transition-transform duration-300" />
                        </div>
                        <div className="p-8 text-center bg-white flex-1">
                            <h3 className="text-2xl font-semibold text-gray-800 mb-2">Tải từ điện thoại</h3>
                            <p className="text-gray-500 text-lg">Quét mã QR để chọn ảnh đẹp sẵn có của bạn</p>
                        </div>
                    </div>
                </motion.div>

            </div>
        </div>
    );
};

export default SourceSelection;
