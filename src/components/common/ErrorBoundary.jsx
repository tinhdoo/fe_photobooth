import { Component } from 'react';

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
