import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { WorkflowProvider, useWorkflow } from './context/WorkflowContext';
import MainLayout from './layouts/MainLayout';
import { isLocalHost } from './utils/runtime';

import Welcome from './components/steps/Welcome';
import SourceSelection from './components/steps/SourceSelection';
import LayoutSelection from './components/steps/LayoutSelection';
import PrintQuantity from './components/steps/PrintQuantity';
import Payment from './components/steps/Payment';

const Capture = lazy(() => import('./components/steps/Capture'));
const Edit = lazy(() => import('./components/steps/Edit'));
const Review = lazy(() => import('./components/steps/Review'));
const Result = lazy(() => import('./components/steps/Result'));
const MobileUploadCapture = lazy(() => import('./components/steps/MobileUploadCapture'));

const ViewPage = lazy(() => import('./pages/ViewPage'));
const MobileUploadClient = lazy(() => import('./pages/MobileUploadClient'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const FrameManager = lazy(() => import('./components/admin/FrameManager'));
const CodeManager = lazy(() => import('./components/admin/CodeManager'));
const RevenueDashboard = lazy(() => import('./components/admin/RevenueDashboard'));
const Settings = lazy(() => import('./components/admin/Settings'));
const BillSettings = lazy(() => import('./components/admin/BillSettings'));
const BrandingSettings = lazy(() => import('./components/admin/BrandingSettings'));

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
        <div className="flex h-full min-h-screen w-full flex-col items-center justify-center bg-white">
            <div className="flex flex-col items-center gap-5">
                <img
                    src={logoUrl}
                    alt="Loading..."
                    className="h-24 w-24 animate-pulse rounded-full object-contain shadow-lg"
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
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true' || sessionStorage.getItem('isAuthenticated') === 'true';
    if (!isAuthenticated) {
        return <Navigate to="/admin/login" replace />;
    }
    return children;
};

const StepContent = () => {
    const { currentStep, sessionData } = useWorkflow();

    switch (currentStep) {
        case 1:
            return <Welcome />;
        case 1.5:
            return <SourceSelection />;
        case 2:
            return <LayoutSelection />;
        case 2.5:
            return <PrintQuantity />;
        case 3:
            return <Payment />;
        case 4:
            return (
                <StepSuspense>
                    {sessionData.source === 'upload' ? <MobileUploadCapture /> : <Capture />}
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
    return <FrameManager />;
};

const CloudAdminRoute = ({ children }) => {
    if (isLocalHost()) return <Navigate to="/admin/settings" replace />;
    return children;
};

const App = () => {
    return (
        <BrowserRouter>
            <WorkflowProvider>
                <Suspense fallback={<LoadingScreen />}>
                    <Routes>
                        <Route
                            path="/"
                            element={
                                <MainLayout>
                                    <StepContent />
                                </MainLayout>
                            }
                        />

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
                            <Route path="codes" element={<CloudAdminRoute><CodeManager /></CloudAdminRoute>} />
                            <Route path="revenue" element={<CloudAdminRoute><RevenueDashboard /></CloudAdminRoute>} />
                            <Route path="settings" element={<Settings />} />
                            <Route path="bill-settings" element={<BillSettings />} />
                            <Route path="branding" element={<CloudAdminRoute><BrandingSettings /></CloudAdminRoute>} />
                        </Route>
                    </Routes>
                </Suspense>
            </WorkflowProvider>
        </BrowserRouter>
    );
};

export default App;
