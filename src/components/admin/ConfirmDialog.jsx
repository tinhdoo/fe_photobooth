import React from 'react';
import { AlertTriangle, Trash2, Wand2 } from 'lucide-react';

const ConfirmDialog = ({ isOpen, title, message, onConfirm, onCancel, type = 'danger', confirmText = 'Xác nhận', cancelText = 'Hủy' }) => {
    if (!isOpen) return null;

    const isDestructive = type === 'danger';

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] animate-fadeIn">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all scale-100 animate-scaleIn">
                <div className="p-6 text-center">
                    <div className={`mx-auto flex items-center justify-center h-12 w-12 rounded-full mb-4 ${isDestructive ? 'bg-red-100' : 'bg-purple-100'}`}>
                        {type === 'danger' && <AlertTriangle className="h-6 w-6 text-red-600" />}
                        {type === 'info' && <Wand2 className="h-6 w-6 text-purple-600" />}
                    </div>
                    <h3 className="text-xl font-bold text-[#2f3e46] mb-2">{title}</h3>
                    <p className="text-sm text-gray-500 mb-6">
                        {message}
                    </p>

                    <div className="flex gap-3 justify-center">
                        <button
                            type="button"
                            className="flex-1 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium transition-colors"
                            onClick={onCancel}
                        >
                            {cancelText}
                        </button>
                        <button
                            type="button"
                            className={`flex-1 px-4 py-2 text-white rounded-lg font-bold shadow-sm transition-colors ${isDestructive
                                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                                : 'bg-purple-600 hover:bg-purple-700 focus:ring-purple-500'
                                }`}
                            onClick={onConfirm}
                        >
                            {confirmText}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConfirmDialog;
