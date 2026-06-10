import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, RefreshCw, Settings as SettingsIcon, Monitor } from 'lucide-react';
import DeviceManager from './DeviceManager';

const Settings = () => {
    const [activeTab, setActiveTab] = useState('general');
    const [configs, setConfigs] = useState({
        price: '60000',
        print_price: '20000',
        mobile_price: '30000',
        mobile_print_price: '10000',
        session_timeout: '600',
        mobile_session_timeout: '300',
        countdown: '5',
        printer_name: 'RX1HS',
        printer_copies: '1',
        camera_mode: 'webcam',
        hot_folder: 'C:/Photobooth_Input',
        trigger_key: '{F8}'
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        fetchConfigs();
    }, []);

    const fetchConfigs = async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/config');
            if (res.data) {
                // Merge with defaults to ensure keys exist
                setConfigs(prev => ({ ...prev, ...res.data }));
            }
        } catch (error) {
            console.error("Error fetching configs:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        setConfigs({ ...configs, [e.target.name]: e.target.value });
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            await axios.post('/api/config', configs);
            setMessage({ type: 'success', text: 'Cài đặt đã được lưu thành công!' });
        } catch (error) {
            console.error("Error saving configs:", error);
            setMessage({ type: 'error', text: 'Lỗi khi lưu cài đặt.' });
        } finally {
            setSaving(false);
            // Auto hide message
            setTimeout(() => setMessage(null), 3000);
        }
    };

    return (
        <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-6rem)] animate-fadeIn">
            {/* Left Sidebar: Navigation & Header */}
            <div className="w-full lg:w-64 flex-shrink-0 flex flex-col gap-6">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-[#2f3e46] tracking-tight">Cài đặt & Thiết bị</h1>
                    <p className="text-[#52796f] mt-1 text-sm md:text-base">Quản lý cấu hình hệ thống và các thiết bị kết nối.</p>
                </div>

                <nav className="space-y-2">
                    <button
                        onClick={() => setActiveTab('general')}
                        className={`w-full flex items-center gap-3 px-4 py-4 rounded-xl font-bold transition-all text-left ${activeTab === 'general'
                            ? 'bg-white text-[#52796f] shadow-sm border border-green-100'
                            : 'text-gray-500 hover:bg-gray-50 hover:text-[#52796f]'
                            }`}
                    >
                        <div className={`p-2 rounded-lg ${activeTab === 'general' ? 'bg-[#52796f]/10' : 'bg-transparent'}`}>
                            <SettingsIcon size={20} />
                        </div>
                        Cài đặt chung
                    </button>

                    <button
                        onClick={() => setActiveTab('devices')}
                        className={`w-full flex items-center gap-3 px-4 py-4 rounded-xl font-bold transition-all text-left ${activeTab === 'devices'
                            ? 'bg-white text-[#52796f] shadow-sm border border-green-100'
                            : 'text-gray-500 hover:bg-gray-50 hover:text-[#52796f]'
                            }`}
                    >
                        <div className={`p-2 rounded-lg ${activeTab === 'devices' ? 'bg-[#52796f]/10' : 'bg-transparent'}`}>
                            <Monitor size={20} />
                        </div>
                        Quản lý Thiết bị
                    </button>
                </nav>
            </div>

            {/* Right Content Area */}
            <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                {activeTab === 'general' ? (
                    <div className="h-full flex flex-col">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <h2 className="text-xl font-bold text-[#2f3e46] flex items-center gap-2">
                                <SettingsIcon size={20} className="text-[#52796f]" />
                                Cấu hình chung
                            </h2>
                            <button
                                onClick={fetchConfigs}
                                className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors"
                                title="Làm mới"
                            >
                                <RefreshCw size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8">
                            {message && (
                                <div className={`p-4 mb-8 rounded-xl border ${message.type === 'success' ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-700'} animate-fadeIn`}>
                                    <div className="flex items-center gap-2 font-bold">
                                        {message.type === 'success' ? <Monitor size={18} /> : <div className="w-2 h-2 rounded-full bg-current" />}
                                        {message.text}
                                    </div>
                                </div>
                            )}

                            <div className="space-y-12 max-w-5xl mx-auto pb-12">
                                {/* SECTION 1: THANH TOÁN & IN ẤN */}
                                <div className="space-y-4">
                                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider border-b pb-2">Thanh toán & In ấn</h3>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Kiosk Flow */}
                                        <div className="bg-gray-50/80 p-6 rounded-2xl border border-gray-100 space-y-6">
                                            <h4 className="text-base font-bold text-[#354f52] flex items-center gap-2 tracking-wide">
                                                📸 Chụp tại quầy
                                            </h4>

                                            <div className="group">
                                                <label className="block text-xs font-bold text-gray-700 mb-2">
                                                    Giá mỗi lượt chụp
                                                </label>
                                                <div className="relative rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-[#52796f]/20">
                                                    <input type="number" name="price" value={configs.price} onChange={handleChange} className="block w-full rounded-xl border-gray-200 pl-4 pr-12 py-2.5 text-sm focus:border-[#52796f]" />
                                                    <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                                                        <span className="text-gray-400 font-bold text-xs uppercase">VND</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="group">
                                                <label className="block text-xs font-bold text-gray-700 mb-2">
                                                    Giá bản in thêm
                                                </label>
                                                <div className="relative rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-[#52796f]/20">
                                                    <input type="number" name="print_price" value={configs.print_price} onChange={handleChange} className="block w-full rounded-xl border-gray-200 pl-4 pr-12 py-2.5 text-sm focus:border-[#52796f]" />
                                                    <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                                                        <span className="text-gray-400 font-bold text-xs uppercase">VND</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="group">
                                                <label className="block text-xs font-bold text-gray-700 mb-2">
                                                    Tên máy in Windows
                                                </label>
                                                <input
                                                    type="text"
                                                    name="printer_name"
                                                    value={configs.printer_name}
                                                    onChange={handleChange}
                                                    placeholder="RX1HS hoặc tên printer trong Windows"
                                                    className="block w-full rounded-xl border-gray-200 px-4 py-2.5 text-sm focus:border-[#52796f]"
                                                />
                                                <p className="mt-2 text-xs text-gray-400">Ví dụ: RX1HS, DNP DS-RX1HS, DS-RX1.</p>
                                            </div>
                                        </div>

                                        {/* Mobile Upload Flow */}
                                        <div className="bg-[#f8fcf3] p-6 rounded-2xl border border-[#e6eedf] space-y-6">
                                            <h4 className="text-base font-bold text-[#52796f] flex items-center gap-2 tracking-wide">
                                                📱 Tải trực tuyến
                                            </h4>

                                            <div className="group">
                                                <label className="block text-xs font-bold text-[#52796f] mb-2">
                                                    Giá mỗi phiên tải
                                                </label>
                                                <div className="relative rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-[#52796f]/20">
                                                    <input type="number" name="mobile_price" value={configs.mobile_price} onChange={handleChange} className="block w-full rounded-xl border-[#e6eedf] pl-4 pr-12 py-2.5 text-sm focus:border-[#52796f]" />
                                                    <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                                                        <span className="text-gray-400 font-bold text-xs uppercase">VND</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="group">
                                                <label className="block text-xs font-bold text-[#52796f] mb-2">
                                                    Giá bản in thêm
                                                </label>
                                                <div className="relative rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-[#52796f]/20">
                                                    <input type="number" name="mobile_print_price" value={configs.mobile_print_price} onChange={handleChange} className="block w-full rounded-xl border-[#e6eedf] pl-4 pr-12 py-2.5 text-sm focus:border-[#52796f]" />
                                                    <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                                                        <span className="text-gray-400 font-bold text-xs uppercase">VND</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* SECTION 2: THỜI GIAN CHỤP */}
                                <div className="space-y-4">
                                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider border-b pb-2">Thời gian & Trải nghiệm</h3>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="bg-white p-6 rounded-2xl border border-gray-100 space-y-6 shadow-sm">
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-2">
                                                    Thời gian 1 phiên chụp (giây)
                                                </label>
                                                <input type="number" name="session_timeout" value={configs.session_timeout} onChange={handleChange} className="block w-full rounded-xl border-gray-200 py-2.5 px-4 text-sm" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-2">
                                                    Đếm ngược mỗi ảnh (giây)
                                                </label>
                                                <input type="number" name="countdown" value={configs.countdown} onChange={handleChange} className="block w-full rounded-xl border-gray-200 py-2.5 px-4 text-sm" />
                                            </div>
                                        </div>

                                        <div className="bg-white p-6 rounded-2xl border border-gray-100 space-y-6 shadow-sm">
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-2">
                                                    Thời gian 1 phiên tải ảnh điện thoại (giây)
                                                </label>
                                                <input type="number" name="mobile_session_timeout" value={configs.mobile_session_timeout} onChange={handleChange} className="block w-full rounded-xl border-gray-200 py-2.5 px-4 text-sm" />
                                                <p className="text-xs text-gray-400 mt-2">Dành riêng cho khách tự upload ảnh từ thiết bị cá nhân.</p>
                                            </div>

                                        </div>
                                    </div>
                                </div>


                                {/* Full Width Column */}
                                <div className="col-span-1 md:col-span-2 space-y-6 pt-6 border-t border-gray-100">
                                    {/* Camera Mode */}
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">
                                            Chế độ Camera
                                        </label>
                                        <div className="relative rounded-xl shadow-sm">
                                            <select
                                                name="camera_mode"
                                                value={configs.camera_mode}
                                                onChange={handleChange}
                                                className="block w-full rounded-xl border-gray-200 pl-4 pr-10 py-3 focus:border-[#52796f] focus:ring-[#52796f] bg-white"
                                            >
                                                <option value="webcam">Webcam (USB / Laptop)</option>
                                                <option value="canon">Canon Direct (Middleware)</option>
                                                <option value="hotfolder">Máy ảnh chuyên nghiệp (EOS Utility / Hot Folder)</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* Hot Folder Settings */}
                                    {configs.camera_mode === 'hotfolder' && (
                                        <div className="bg-orange-50 p-6 rounded-2xl border border-orange-100 space-y-4 animate-fadeIn">
                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 mb-2">
                                                    Đường dẫn thư mục ảnh (Hot Folder)
                                                </label>
                                                <input
                                                    type="text"
                                                    name="hot_folder"
                                                    value={configs.hot_folder}
                                                    onChange={handleChange}
                                                    className="block w-full rounded-xl border-orange-200 focus:border-orange-400 focus:ring-orange-400 py-3 pl-4"
                                                    placeholder="C:/Photobooth_Input"
                                                />
                                                <p className="mt-2 text-xs text-orange-600/80">
                                                    Thư mục mà EOS Utility sẽ lưu ảnh vào. Backend sẽ giám sát thư mục này.
                                                </p>
                                            </div>

                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 mb-2">
                                                    Phím chụp (Trigger Key)
                                                </label>
                                                <input
                                                    type="text"
                                                    name="trigger_key"
                                                    value={configs.trigger_key}
                                                    onChange={handleChange}
                                                    className="block w-full rounded-xl border-orange-200 focus:border-orange-400 focus:ring-orange-400 py-3 pl-4 font-mono"
                                                    placeholder="{F8}"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Canon Middleware Settings */}
                                    {configs.camera_mode === 'canon' && (
                                        <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 space-y-4 animate-fadeIn">
                                            <p className="text-sm text-blue-700">
                                                <span className="font-bold">Chế độ này yêu cầu chạy Canon Middleware.</span>
                                                <br />
                                                Hãy đảm bảo bạn đã chạy file <code>canon_middleware.exe</code> và kết nối máy ảnh.
                                                <br />
                                                LiveView và Capture sẽ hoạt động qua cổng <code>http://localhost:5000</code>.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Footer Action */}
                        <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-end">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className={`
                                    flex items-center justify-center gap-2 px-8 py-3 rounded-xl font-bold text-white shadow-lg shadow-[#52796f]/20
                                    ${saving ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#52796f] hover:bg-[#3f6154] hover:shadow-xl hover:scale-[1.02]'}
                                    transition-all duration-200
                                `}
                            >
                                {saving ? (
                                    <>
                                        <RefreshCw size={20} className="animate-spin" />
                                        Đang lưu...
                                    </>
                                ) : (
                                    <>
                                        <Save size={20} />
                                        Lưu thay đổi
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="h-full overflow-y-auto p-8">
                        <DeviceManager />
                    </div>
                )}
            </div>
        </div>
    );
};

export default Settings;
