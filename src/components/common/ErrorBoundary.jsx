import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error, info) {
        console.error('UI crashed:', error, info);
    }

    render() {
        if (this.state.hasError) {
            // ErrorBoundary là global (bọc cả booth lẫn admin). Đồng bộ giao diện theo ngữ
            // cảnh: route /admin dùng tông đỏ tomato của trang quản trị, còn lại giữ tông
            // xanh của màn hình booth cho khách.
            const isAdmin = typeof window !== 'undefined'
                && window.location.pathname.startsWith('/admin');

            if (isAdmin) {
                return (
                    <div className="relative flex h-screen w-screen flex-col items-center justify-center overflow-hidden bg-gray-50 p-6">
                        <div className="absolute left-[-10%] top-[-10%] h-96 w-96 rounded-full bg-[#e63946]/5 blur-3xl" />
                        <div className="absolute bottom-[-10%] right-[-10%] h-96 w-96 rounded-full bg-[#e63946]/5 blur-3xl" />

                        <div className="relative z-10 w-full max-w-md rounded-3xl border border-white/50 bg-white p-10 text-center shadow-xl">
                            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#e63946]/10 text-[#e63946]">
                                <AlertTriangle size={30} />
                            </div>
                            <h1 className="mb-3 font-serif text-3xl font-extrabold text-[#1a1a2e]">Có lỗi xảy ra</h1>
                            <p className="mb-8 text-gray-500">Ứng dụng cần tải lại để tiếp tục phiên hiện tại.</p>
                            <button
                                type="button"
                                onClick={() => window.location.reload()}
                                className="group mx-auto flex items-center justify-center gap-2 rounded-xl bg-[#e63946] px-8 py-3 font-bold text-white shadow-lg shadow-[#e63946]/20 transition-colors hover:bg-[#d62828]"
                            >
                                <RefreshCw size={18} className="transition-transform group-hover:rotate-90" />
                                Tải lại
                            </button>
                        </div>
                    </div>
                );
            }

            return (
                <div className="flex h-screen w-screen items-center justify-center bg-[#F9FAF7] p-8 font-serif text-[#2f3e46]">
                    <div className="max-w-md rounded-3xl bg-white/90 p-8 text-center shadow-md">
                        <h1 className="mb-3 text-3xl font-extrabold text-[#52796f]">Có lỗi xảy ra</h1>
                        <p className="mb-6 text-lg">Ứng dụng cần tải lại để tiếp tục phiên hiện tại.</p>
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="rounded-full bg-[#A8B5A0] px-8 py-3 font-bold text-white transition-colors hover:bg-[#84a98c]"
                        >
                            Tải lại
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
