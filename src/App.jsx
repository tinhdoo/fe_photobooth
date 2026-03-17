import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WorkflowProvider, useWorkflow } from './context/WorkflowContext';
import MainLayout from './layouts/MainLayout';
import AdminLayout from './layouts/AdminLayout';

// Steps
import Welcome from './components/steps/Welcome';
import LayoutSelection from './components/steps/LayoutSelection';
import Capture from './components/steps/Capture';
import Edit from './components/steps/Edit';
import Review from './components/steps/Review';
import Payment from './components/steps/Payment';
import Result from './components/steps/Result';
import ViewPage from './pages/ViewPage';
import SourceSelection from './components/steps/SourceSelection';
import MobileUploadCapture from './components/steps/MobileUploadCapture';
import MobileUploadClient from './pages/MobileUploadClient';

// Admin
import FrameManager from './components/admin/FrameManager';
import CodeManager from './components/admin/CodeManager';
import RevenueDashboard from './components/admin/RevenueDashboard';
import DeviceManager from './components/admin/DeviceManager';
import Settings from './components/admin/Settings';
import BillSettings from './components/admin/BillSettings'; // Added
import PrintQuantity from './components/steps/PrintQuantity';
import AdminLogin from './pages/AdminLogin';
import { Navigate } from 'react-router-dom';

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
            return sessionData.source === 'upload' ? <MobileUploadCapture /> : <Capture />;
        case 5:
            return <Review />;
        case 6:
            return <Edit />;
        case 7:
            return <Result />;
        default:
            return <Welcome />;
    }
};

const App = () => {
    return (
        <BrowserRouter>
            <WorkflowProvider>
                <Routes>
                    {/* Main User Flow */}
                    <Route path="/" element={
                        <MainLayout>
                            <StepContent />
                        </MainLayout>
                    } />

                    {/* View Page (Public) */}
                    <Route path="/album/:id" element={<ViewPage />} />

                    {/* Mobile Upload Route (Public/LAN) */}
                    <Route path="/m/upload/:sessionId" element={<MobileUploadClient />} />

                    {/* Admin Dashboard */}
                    <Route path="/admin/login" element={<AdminLogin />} />
                    <Route path="/admin" element={
                        <ProtectedRoute>
                            <AdminLayout />
                        </ProtectedRoute>
                    }>
                        <Route index element={<FrameManager />} />
                        <Route path="codes" element={<CodeManager />} />
                        <Route path="revenue" element={<RevenueDashboard />} />
                        <Route path="settings" element={<Settings />} />
                        <Route path="bill-settings" element={<BillSettings />} />
                    </Route>
                </Routes>
            </WorkflowProvider>
        </BrowserRouter>
    );
};

export default App;
