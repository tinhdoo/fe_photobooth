import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { WorkflowProvider, useWorkflow } from './context/WorkflowContext';
import MainLayout from './layouts/MainLayout';
import { isLocalHost } from './utils/runtime';
import { isAuthenticated as checkAuth, isStaffRole } from './utils/auth';

import Welcome from './components/steps/Welcome';
import LayoutSelection from './components/steps/LayoutSelection';
import PrintQuantity from './components/steps/PrintQuantity';
import Payment from './components/steps/Payment';
import GetReady from './components/steps/GetReady';

// Lazy-import CÓ TỰ PHỤC HỒI: khi chunk lỗi (thường do đã build/deploy bản mới nhưng tab cũ
// còn trỏ tên chunk hash cũ -> 404), tải lại trang 1 LẦN để lấy index.html + chunk mới, thay
// vì để Suspense treo "ba chấm" vĩnh viễn (không vào được bước Chụp/Edit...).
// TIMEOUT cho import chunk: nếu fetch TREO (server phục vụ frontend "ôi" sau khi máy để idle lâu
// -> import đứng, KHÔNG resolve cũng KHÔNG reject) thì coi như lỗi để kích hoạt reload. Bản cũ chỉ
// bắt reject -> gặp treo là Suspense hiện "ba chấm" VĨNH VIỄN (đúng triệu chứng đơ sau idle).
const importWithTimeout = (importer, ms = 20000) => Promise.race([
    importer(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('chunk-timeout')), ms)),
]);
const lazyWithReload = (importer) => lazy(async () => {
    try {
        const mod = await importWithTimeout(importer);
        sessionStorage.removeItem('ptb_chunk_reloaded'); // tải OK -> reset cờ cho lần sau
        return mod;
    } catch (err) {
        if (!sessionStorage.getItem('ptb_chunk_reloaded')) {
            sessionStorage.setItem('ptb_chunk_reloaded', '1');
            window.location.reload();
            return new Promise(() => { }); // giữ Suspense đến khi trang reload xong
        }
        throw err; // đã reload mà vẫn lỗi -> ném ra (tránh reload lặp vô hạn)
    }
});

const importCapture = () => import('./components/steps/Capture');
const importEdit = () => import('./components/steps/Edit');
const importReview = () => import('./components/steps/Review');
const importResult = () => import('./components/steps/Result');
const Capture = lazyWithReload(importCapture);
const Edit = lazyWithReload(importEdit);
const Review = lazyWithReload(importReview);
const Result = lazyWithReload(importResult);

// Nạp sẵn (preload) chunk các bước Chụp/Edit/Review/Result NGAY lúc app rảnh sau khi mở. Chunk
// nằm sẵn trong bộ nhớ module của tab -> tới bước Chụp là dùng LIỀN, không phải fetch từ server
// (nguồn gây treo "3 chấm" khi khách thanh toán sau lúc máy để idle rất lâu). Idle KHÔNG xoá module
// đã nạp nên chỉ cần nạp 1 lần. Best-effort: lỗi thì bỏ qua (lúc vào bước lazyWithReload sẽ thử lại).
const preloadStepChunks = () => {
    [importCapture, importEdit, importReview, importResult].forEach((imp) => {
        try { imp().catch(() => { }); } catch { /* ignore */ }
    });
};

const ViewPage = lazy(() => import('./pages/ViewPage'));
const MobileUploadClient = lazy(() => import('./pages/MobileUploadClient'));
const FaceFilterDemo = lazy(() => import('./pages/FaceFilterDemo'));
const AIFilterDemo = lazy(() => import('./pages/AIFilterDemo'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const FrameManager = lazy(() => import('./components/admin/FrameManager'));
const CodeManager = lazy(() => import('./components/admin/CodeManager'));
const RevenueDashboard = lazy(() => import('./components/admin/RevenueDashboard'));
const Settings = lazy(() => import('./components/admin/Settings'));
const BillSettings = lazy(() => import('./components/admin/BillSettings'));
const BrandingSettings = lazy(() => import('./components/admin/BrandingSettings'));
const StaffManager = lazy(() => import('./components/admin/StaffManager'));

const LoadingScreen = () => {
    let logoUrl = '/logo_tomato.png';
    try {
        const context = useWorkflow();
        if (context?.configs?.logo_main) {
            logoUrl = context.configs.logo_main;
        }
    } catch (e) {
        // Fallback if useWorkflow is used outside WorkflowProvider
    }

    return (
        <div className="flex h-full min-h-screen w-full flex-col items-center justify-center bg-[#FFF8E7]">
            <div className="flex flex-col items-center gap-5">
                <img
                    src={logoUrl}
                    alt="Loading..."
                    className="h-24 w-24 animate-pulse object-contain"
                    onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = '/logo_tomato.png';
                    }}
                />
                <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#e63946]" style={{ animationDelay: '0ms' }} />
                    <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#e63946]" style={{ animationDelay: '150ms' }} />
                    <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#e63946]" style={{ animationDelay: '300ms' }} />
                </div>
            </div>
        </div>
    );
};

const StepSuspense = ({ children }) => (
    <Suspense fallback={<LoadingScreen />}>
        {children}
    </Suspense>
);

const ProtectedRoute = ({ children }) => {
    if (!checkAuth()) {
        return <Navigate to="/admin/login" replace />;
    }
    return children;
};

// Chặn nhân viên (role 'staff'): họ chỉ được vào "Mã thanh toán". Route khác -> đẩy về /admin/codes.
const AdminOnlyRoute = ({ children }) => {
    if (isStaffRole()) return <Navigate to="/admin/codes" replace />;
    return children;
};

const StepContent = () => {
    const { currentStep } = useWorkflow();

    switch (currentStep) {
        case 1:
            return <Welcome />;
        case 2:
            return <LayoutSelection />;
        case 2.5:
            return <PrintQuantity />;
        case 3:
            return <Payment />;
        case 3.5:
            return <GetReady />;
        case 4:
            return (
                <StepSuspense>
                    <Capture />
                </StepSuspense>
            );
        case 5:
            return (
                <StepSuspense>
                    <Review />
                </StepSuspense>
            );
        case 6:
            return (
                <StepSuspense>
                    <Edit />
                </StepSuspense>
            );
        case 7:
            return (
                <StepSuspense>
                    <Result />
                </StepSuspense>
            );
        default:
            return <Welcome />;
    }
};

const AdminIndex = () => {
    if (isLocalHost()) return <Navigate to="/admin/settings" replace />;
    // Nhân viên chỉ có mục Mã thanh toán -> vào thẳng.
    if (isStaffRole()) return <Navigate to="/admin/codes" replace />;
    // Trang mặc định: mobile mở thẳng "Mã thanh toán" (nhẹ + dùng nhiều nhất trên điện thoại),
    // desktop vào trang quản lý khung hình. Frame có route riêng (/admin/frames) để nút Frame
    // không bị điều hướng lại về trang thanh toán trên mobile.
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        return <Navigate to="/admin/codes" replace />;
    }
    return <Navigate to="/admin/frames" replace />;
};

const CloudAdminRoute = ({ children }) => {
    if (isLocalHost()) return <Navigate to="/admin/settings" replace />;
    return children;
};

const App = () => {
    // Booth: nạp sẵn chunk bước chụp khi rảnh -> tới bước Chụp không phải fetch -> tránh treo
    // "3 chấm" khi khách thanh toán sau lúc máy để idle lâu. Chỉ chạy trên máy booth (localhost).
    useEffect(() => {
        if (!isLocalHost()) return undefined;
        const run = () => preloadStepChunks();
        if (typeof window !== 'undefined' && window.requestIdleCallback) {
            const id = window.requestIdleCallback(run, { timeout: 4000 });
            return () => window.cancelIdleCallback && window.cancelIdleCallback(id);
        }
        const t = setTimeout(run, 1500);
        return () => clearTimeout(t);
    }, []);

    return (
        <BrowserRouter>
            <WorkflowProvider>
                <Suspense fallback={<LoadingScreen />}>
                    <Routes>
                        <Route
                            path="/"
                            element={
                                // Cloud (Vercel) chỉ dùng để QUẢN LÝ -> không chạy luồng chụp booth ở đây,
                                // chuyển thẳng vào /admin. Luồng chụp chỉ chạy trên máy booth (localhost).
                                isLocalHost() ? (
                                    <MainLayout>
                                        <StepContent />
                                    </MainLayout>
                                ) : (
                                    <Navigate to="/admin" replace />
                                )
                            }
                        />

                        <Route path="/face-filter" element={<FaceFilterDemo />} />
                        <Route path="/ai-filter" element={<AIFilterDemo />} />
                        <Route path="/album/:id" element={<ViewPage />} />
                        <Route path="/m/upload/:sessionId" element={<MobileUploadClient />} />
                        <Route path="/admin/login" element={<AdminLogin />} />
                        <Route
                            path="/admin"
                            element={
                                <ProtectedRoute>
                                    <AdminLayout />
                                </ProtectedRoute>
                            }
                        >
                            <Route index element={<AdminIndex />} />
                            <Route path="frames" element={<CloudAdminRoute><AdminOnlyRoute><FrameManager /></AdminOnlyRoute></CloudAdminRoute>} />
                            <Route path="codes" element={<CloudAdminRoute><CodeManager /></CloudAdminRoute>} />
                            <Route path="revenue" element={<CloudAdminRoute><AdminOnlyRoute><RevenueDashboard /></AdminOnlyRoute></CloudAdminRoute>} />
                            <Route path="staff" element={<CloudAdminRoute><AdminOnlyRoute><StaffManager /></AdminOnlyRoute></CloudAdminRoute>} />
                            <Route path="settings" element={<AdminOnlyRoute><Settings /></AdminOnlyRoute>} />
                            <Route path="bill-settings" element={<AdminOnlyRoute><BillSettings /></AdminOnlyRoute>} />
                            <Route path="branding" element={<CloudAdminRoute><AdminOnlyRoute><BrandingSettings /></AdminOnlyRoute></CloudAdminRoute>} />
                        </Route>
                    </Routes>
                </Suspense>
            </WorkflowProvider>
        </BrowserRouter>
    );
};

export default App;
