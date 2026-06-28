import { useState, useEffect } from 'react';
import axios from 'axios';
import { Camera, CheckCircle2, Printer, Save, RefreshCw, Settings as SettingsIcon, Monitor, Wifi, XCircle, Banknote, Zap, DollarSign } from 'lucide-react';
import DeviceManager from './DeviceManager';
import { isLocalHost } from '../../utils/runtime';
import { useWorkflow } from '../../context/WorkflowContext';

const Settings = ({ forceLocalAdmin = false }) => {
    const isLocalAdmin = isLocalHost() || forceLocalAdmin;
    const { isEventMode, toggleEventMode } = useWorkflow();
    const [activeTab, setActiveTab] = useState('general');
    const [configs, setConfigs] = useState({
        price: '60000',
        print_price: '20000',
        mobile_price: '30000',
        mobile_print_price: '10000',
        session_timeout: '600',
        mobile_session_timeout: '300',
        countdown: '5',
        hotfolder_capture_timeout: '30',
        canon_capture_timeout: '30',
        printer_name: 'RX1HS',
        printer_copies: '1',
        print_brightness: '0',
        print_contrast: '0',
        print_saturation: '0',
        print_warmth: '0',
        print_red: '0',
        print_green: '0',
        print_blue: '0',
        camera_mode: 'canon',
        hot_folder: 'C:/Photobooth_Input',
        trigger_key: '{F8}',
        price_schedule: '[]',
        print_scale_x: '100',
        print_scale_y: '100',
        print_offset_x: '0',
        print_offset_y: '0'
    });
    const [priceScheduleForm, setPriceScheduleForm] = useState({
        run_at: '',
        price: '',
        print_price: '',
        mobile_price: '',
        mobile_print_price: '',
        repeat: false, // true = lặp lại mỗi ngày vào đúng giờ, tới khi xóa
    });
    const [, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);
    const [hardware, setHardware] = useState(null);
    const [hardwareLoading, setHardwareLoading] = useState(false);
    const [testLoading, setTestLoading] = useState(null);
    const [cameraTestOk, setCameraTestOk] = useState(false);

    useEffect(() => {
        fetchConfigs();
    }, []);

    useEffect(() => {
        if (!isLocalAdmin) return;
        fetchHardwareStatus();
        const interval = setInterval(fetchHardwareStatus, 15000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLocalAdmin]);

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
        if (e.target.name === 'camera_mode') {
            setCameraTestOk(false);
        }
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

    const getPriceSchedule = () => {
        try {
            const parsed = JSON.parse(configs.price_schedule || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    };

    const setPriceSchedule = (schedule) => {
        setConfigs((prev) => ({ ...prev, price_schedule: JSON.stringify(schedule) }));
    };

    // Lưu lịch giá NGAY xuống backend (POST /api/config merge từng key) -> thêm/xóa có hiệu lực liền,
    // không cần bấm "Lưu cấu hình"; reload cũng không bị lịch quay lại.
    const persistPriceSchedule = async (schedule) => {
        setPriceSchedule(schedule);
        try {
            await axios.post('/api/config', { price_schedule: JSON.stringify(schedule) });
        } catch (error) {
            console.error('Lưu lịch giá thất bại:', error);
            setMessage({ type: 'error', text: 'Lưu lịch giá thất bại, thử lại.' });
        }
    };

    const addPriceSchedule = () => {
        if (!priceScheduleForm.run_at) {
            setMessage({ type: 'error', text: 'Chọn thời gian áp dụng giá.' });
            return;
        }

        const item = {
            id: `${Date.now()}`,
            run_at: priceScheduleForm.run_at,
            price: priceScheduleForm.price || configs.price,
            print_price: priceScheduleForm.print_price || configs.print_price,
            mobile_price: priceScheduleForm.mobile_price || configs.mobile_price,
            mobile_print_price: priceScheduleForm.mobile_print_price || configs.mobile_print_price,
            // daily = lặp mỗi ngày vào đúng giờ của run_at (bỏ qua phần ngày); once = chạy 1 lần.
            repeat: priceScheduleForm.repeat ? 'daily' : 'once',
            applied: false,
        };

        const nextSchedule = [...getPriceSchedule(), item].sort((a, b) => String(a.run_at).localeCompare(String(b.run_at)));
        persistPriceSchedule(nextSchedule);
        setPriceScheduleForm({
            run_at: '',
            price: '',
            print_price: '',
            mobile_price: '',
            mobile_print_price: '',
            repeat: false,
        });
        setMessage({ type: 'success', text: 'Đã thêm lịch giá.' });
    };

    // Xóa theo VỊ TRÍ (chắc chắn dù id thiếu/trùng) + lưu ngay
    const removePriceSchedule = (index) => {
        const next = getPriceSchedule().filter((_, i) => i !== index);
        persistPriceSchedule(next);
        setMessage({ type: 'success', text: 'Đã xóa lịch.' });
    };

    const fetchHardwareStatus = async () => {
        if (!isLocalAdmin) return;
        setHardwareLoading(true);
        try {
            const [hwRes, billRes] = await Promise.all([
                axios.get('/api/hardware/status'),
                axios.get('/api/bill/status').catch(() => ({ data: { enabled: false, status: 'error' } }))
            ]);
            setHardware({
                ...hwRes.data,
                bill: billRes.data
            });
        } catch (error) {
            console.error("Error fetching hardware status:", error);
            setHardware({
                ok: false,
                checks: { printer: false, camera: false, internet: false, supabase: false },
                printer: { online: false, message: 'Không đọc được trạng thái máy in' },
                camera: { online: false, message: 'Không đọc được trạng thái máy ảnh' },
                internet: { online: false, message: 'Không kiểm tra được Internet' },
                supabase: { online: false, message: 'Không kiểm tra được Supabase' },
                bill: { enabled: false, status: 'error' }
            });
        } finally {
            setHardwareLoading(false);
        }
    };

    const runTestPrint = async () => {
        setTestLoading('printer');
        setMessage(null);
        try {
            await axios.post('/api/printer/test', {
                printer_name: configs.printer_name,
                print_brightness: configs.print_brightness,
                print_contrast: configs.print_contrast,
                print_saturation: configs.print_saturation,
                print_warmth: configs.print_warmth,
                print_red: configs.print_red,
                print_green: configs.print_green,
                print_blue: configs.print_blue,
            });
            setMessage({ type: 'success', text: 'Đã gửi lệnh in thử sang máy in.' });
            fetchHardwareStatus();
        } catch (error) {
            console.error("Test print failed:", error);
            setMessage({ type: 'error', text: error.response?.data?.error || 'Không in thử được.' });
        } finally {
            setTestLoading(null);
            setTimeout(() => setMessage(null), 3000);
        }
    };

    const runCameraTest = async () => {
        setTestLoading('camera');
        setMessage(null);
        try {
            if (configs.camera_mode === 'webcam') {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                stream.getTracks().forEach((track) => track.stop());
                setCameraTestOk(true);
                setHardware((prev) => ({
                    ...prev,
                    checks: { ...(prev?.checks || {}), camera: true },
                    camera: {
                        ...(prev?.camera || {}),
                        online: true,
                        name: 'Webcam / USB camera',
                        message: 'Đã kết nối'
                    }
                }));
                setMessage({ type: 'success', text: 'Camera đã sẵn sàng.' });
            } else if (configs.camera_mode === 'hotfolder') {
                await axios.post('/api/camera/capture');
                setCameraTestOk(true);
                setMessage({ type: 'success', text: 'Đã gửi lệnh chụp thử hot folder.' });
            } else {
                setMessage({ type: 'error', text: 'Chế độ Canon cần kiểm tra trong middleware Canon.' });
            }
        } catch (error) {
            console.error("Camera test failed:", error);
            setMessage({ type: 'error', text: error.response?.data?.error || 'Không chụp thử được.' });
        } finally {
            setTestLoading(null);
            fetchHardwareStatus();
            setTimeout(() => setMessage(null), 3000);
        }
    };

    const statusTone = (online) => {
        if (online === true) return 'text-green-600 bg-green-50 border-green-100';
        if (online === false) return 'text-red-600 bg-red-50 border-red-100';
        return 'text-amber-700 bg-amber-50 border-amber-100';
    };

    const statusDot = (online) => (
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${online === true ? 'bg-green-500' : online === false ? 'bg-red-500' : 'bg-amber-400'}`} />
    );

    const healthItem = (label, ok, Icon) => (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/80 px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-bold text-[#1a1a2e]">
                <Icon size={16} className="text-[#e63946]" />
                {label}
            </span>
            {ok ? <CheckCircle2 size={18} className="text-green-600" /> : <XCircle size={18} className="text-red-500" />}
        </div>
    );

    const printColorControls = [
        { name: 'print_brightness', label: 'Độ sáng', min: -30, max: 30, step: 1 },
        { name: 'print_contrast', label: 'Tương phản', min: -30, max: 30, step: 1 },
        { name: 'print_saturation', label: 'Bão hòa màu', min: -30, max: 30, step: 1 },
        { name: 'print_warmth', label: 'Độ ấm màu', min: -20, max: 20, step: 1 },
        { name: 'print_red', label: 'Đỏ (R)', min: -50, max: 50, step: 1 },
        { name: 'print_green', label: 'Xanh lá (G)', min: -50, max: 50, step: 1 },
        { name: 'print_blue', label: 'Xanh dương (B)', min: -50, max: 50, step: 1 },
    ];

    const renderPrintColorControls = () => (
        <section className="rounded-2xl border border-[#ead8bd] bg-[#fffaf0] p-6 shadow-sm lg:col-span-2">
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <h2 className="text-xl font-bold text-[#1a1a2e]">Màu ảnh in</h2>
                    <p className="mt-1 text-sm text-[#7B5E43]">
                        Áp dụng trực tiếp lên file gửi máy in. Ảnh tải QR/cloud vẫn giữ màu gốc.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setConfigs(prev => ({
                        ...prev,
                        print_brightness: '0',
                        print_contrast: '0',
                        print_saturation: '0',
                        print_warmth: '0',
                        print_red: '0',
                        print_green: '0',
                        print_blue: '0',
                    }))}
                    className="rounded-xl border border-[#d8c0a0] bg-white px-4 py-2 text-sm font-bold text-[#7B5E43]"
                >
                    Về mặc định (0)
                </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                {printColorControls.map((control) => (
                    <label key={control.name} className="rounded-2xl border border-[#ead8bd] bg-white p-4">
                        <div className="mb-3 flex items-center justify-between gap-4">
                            <span className="text-sm font-extrabold text-[#1a1a2e]">{control.label}</span>
                            <input
                                type="number"
                                name={control.name}
                                min={control.min}
                                max={control.max}
                                step={control.step}
                                value={configs[control.name]}
                                onChange={handleChange}
                                className="h-10 w-20 rounded-xl border border-[#ead8bd] bg-[#fffaf0] text-center text-sm font-bold text-[#7B5E43]"
                            />
                        </div>
                        <input
                            type="range"
                            name={control.name}
                            min={control.min}
                            max={control.max}
                            step={control.step}
                            value={configs[control.name]}
                            onChange={handleChange}
                            className="h-2 w-full accent-[#DDBF9B]"
                        />
                    </label>
                ))}
            </div>
        </section>
    );

    if (isLocalAdmin) {
        const printer = hardware?.printer || {};
        const camera = hardware?.camera || {};
        const bill = hardware?.bill || {};
        const billOk = !bill.enabled || bill.status === 'connected';
        const checks = { ...(hardware?.checks || {}), camera: cameraTestOk || Boolean(hardware?.checks?.camera), bill: billOk };
        // Supabase là dịch vụ cloud (không phải phần cứng local) -> không tính vào hardwareOk
        const hardwareOk = Boolean(checks.printer && checks.camera && checks.internet && checks.bill);

        return (
            <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold text-[#1a1a2e] tracking-tight">Cài đặt phần cứng</h1>
                        <p className="mt-1 text-sm md:text-base text-[#e63946]">
                            Chỉ cấu hình các thiết bị gắn trực tiếp với máy photobooth local.
                        </p>
                    </div>

                    <div className={`w-full rounded-2xl border p-4 shadow-sm lg:w-80 ${hardwareOk ? 'border-green-100 bg-green-50' : 'border-amber-100 bg-[#FFF8E8]'}`}>
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                {statusDot(hardwareOk)}
                                <span className="text-base font-extrabold text-[#1a1a2e]">
                                    {hardwareOk ? 'Hardware OK' : 'Cần kiểm tra phần cứng'}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={fetchHardwareStatus}
                                className="rounded-full p-2 text-[#e63946]"
                                title="Làm mới trạng thái"
                            >
                                <RefreshCw size={18} className={hardwareLoading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                        <div className="grid gap-2">
                            {healthItem('Printer', checks.printer, Printer)}
                            {healthItem('Camera', checks.camera, Camera)}
                            {healthItem('Internet', checks.internet, Wifi)}
                            {bill.enabled && healthItem('Đầu đọc tiền', checks.bill, Banknote)}
                        </div>
                    </div>
                </div>

                {message && (
                    <div className={`rounded-xl border p-4 ${message.type === 'success' ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                        {message.text}
                    </div>
                )}

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="mb-5 flex items-start justify-between gap-4">
                            <div>
                                <h2 className="flex items-center gap-2 text-xl font-bold text-[#1a1a2e]">
                                    <Printer size={22} className="text-[#e63946]" />
                                    Máy in
                                </h2>
                                <p className="mt-1 text-sm font-bold text-[#e63946]">{printer.name || 'DNP RX1HS'}</p>
                            </div>
                            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-bold ${statusTone(printer.online)}`}>
                                {statusDot(printer.online)}
                                {printer.online ? 'Online' : 'Chưa kết nối'}
                            </span>
                        </div>
                        <div className="grid gap-3 rounded-2xl bg-[#F8F3E7] p-4 text-sm">
                            <div className="flex justify-between gap-4">
                                <span className="font-bold text-gray-500">Status</span>
                                <span className="text-right font-bold text-[#1a1a2e]">{printer.status || printer.message || '--'}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="font-bold text-gray-500">Paper</span>
                                <span className="text-right font-bold text-[#1a1a2e]">{printer.paper || '4x6'}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="font-bold text-gray-500">Số giấy còn lại</span>
                                <span className="text-right font-bold text-[#1a1a2e]">
                                    {printer.remaining_label
                                        || (printer.remaining != null ? `${printer.remaining} tấm` : '--')}
                                </span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span className="font-bold text-gray-500">Driver</span>
                                <span className="text-right font-bold text-[#1a1a2e]">{printer.driver || 'Unknown'}</span>
                            </div>
                        </div>
                        <div className="mt-5 flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={fetchHardwareStatus}
                                className="rounded-xl border border-[#d8c0a0] px-5 py-2.5 text-sm font-bold text-[#7B5E43]"
                            >
                                Kiểm tra
                            </button>
                            <button
                                type="button"
                                onClick={runTestPrint}
                                disabled={testLoading === 'printer'}
                                className="rounded-xl bg-[#DDBF9B] px-5 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-60"
                            >
                                {testLoading === 'printer' ? 'Đang in thử...' : 'In thử'}
                            </button>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="mb-5 flex items-start justify-between gap-4">
                            <div>
                                <h2 className="flex items-center gap-2 text-xl font-bold text-[#1a1a2e]">
                                    <Camera size={22} className="text-[#e63946]" />
                                    Máy ảnh
                                </h2>
                                <p className="mt-1 text-sm font-bold text-[#e63946]">{camera.name || 'Webcam / Canon'}</p>
                            </div>
                            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-bold ${statusTone(cameraTestOk || camera.online)}`}>
                                {statusDot(cameraTestOk || camera.online)}
                                {cameraTestOk ? 'Đã kết nối' : camera.online === false ? 'Chưa kết nối' : 'Cần chụp thử'}
                            </span>
                        </div>
                        <div className="rounded-2xl bg-[#F8F3E7] p-4 text-sm leading-6 text-[#1a1a2e]">
                            <div className="flex justify-between gap-4">
                                <span className="font-bold text-gray-500">Mode</span>
                                <span className="text-right font-bold">{camera.mode || configs.camera_mode}</span>
                            </div>
                            <div className="mt-3 flex justify-between gap-4">
                                <span className="font-bold text-gray-500">Status</span>
                                <span className="text-right font-bold">{camera.message || '--'}</span>
                            </div>
                        </div>
                        <div className="mt-5 flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={fetchHardwareStatus}
                                className="rounded-xl border border-[#d8c0a0] px-5 py-2.5 text-sm font-bold text-[#7B5E43]"
                            >
                                Kiểm tra
                            </button>
                            <button
                                type="button"
                                onClick={runCameraTest}
                                disabled={testLoading === 'camera'}
                                className="rounded-xl bg-[#DDBF9B] px-5 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-60"
                            >
                                {testLoading === 'camera' ? 'Đang chụp thử...' : 'Chụp thử'}
                            </button>
                        </div>
                    </section>

                    {bill.enabled && (
                        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                            <div className="mb-5 flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="flex items-center gap-2 text-xl font-bold text-[#1a1a2e]">
                                        <Banknote size={22} className="text-[#e63946]" />
                                        Máy đọc tiền
                                    </h2>
                                    <p className="mt-1 text-sm font-bold text-[#e63946]">Cổng {bill.port || 'Chưa thiết lập'}</p>
                                </div>
                                <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-bold ${statusTone(billOk)}`}>
                                    {statusDot(billOk)}
                                    {!bill.enabled ? 'Đang tắt' : (bill.status === 'connected' ? 'Đã kết nối' : 'Mất kết nối')}
                                </span>
                            </div>
                            <div className="rounded-2xl bg-[#F8F3E7] p-4 text-sm leading-6 text-[#1a1a2e]">
                                <div className="flex justify-between gap-4">
                                    <span className="font-bold text-gray-500">Trạng thái cấu hình</span>
                                    <span className="text-right font-bold">{bill.enabled ? 'Bật' : 'Tắt'}</span>
                                </div>
                                <div className="mt-3 flex justify-between gap-4">
                                    <span className="font-bold text-gray-500">Tình trạng kết nối</span>
                                    <span className="text-right font-bold">{bill.status === 'connected' ? 'OK' : 'Lỗi'}</span>
                                </div>
                            </div>
                            <div className="mt-5 flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={fetchHardwareStatus}
                                    className="rounded-xl border border-[#d8c0a0] px-5 py-2.5 text-sm font-bold text-[#7B5E43]"
                                >
                                    Kiểm tra
                                </button>
                            </div>
                        </section>
                    )}
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="mb-6 flex items-center justify-between gap-4">
                            <div>
                                <h2 className="text-xl font-bold text-[#1a1a2e]">Máy in</h2>
                                <p className="mt-1 text-sm text-[#e63946]">Dùng cho DNP RX1HS hoặc máy in Windows tương thích.</p>
                            </div>
                            <Monitor className="text-[#e63946]" size={24} />
                        </div>

                        <div className="space-y-5">
                            <label className="block">
                                <span className="mb-2 block text-sm font-bold text-gray-700">Tên máy in Windows</span>
                                <input
                                    type="text"
                                    name="printer_name"
                                    value={configs.printer_name}
                                    onChange={handleChange}
                                    placeholder="RX1HS hoặc DNP DS-RX1HS"
                                    className="block w-full rounded-xl border-gray-200 px-4 py-3 text-sm focus:border-[#e63946] focus:ring-[#e63946]"
                                />
                            </label>

                            <label className="block">
                                <span className="mb-2 block text-sm font-bold text-gray-700">Số bản in mặc định</span>
                                <input
                                    type="number"
                                    min="1"
                                    name="printer_copies"
                                    value={configs.printer_copies}
                                    onChange={handleChange}
                                    className="block w-full rounded-xl border-gray-200 px-4 py-3 text-sm focus:border-[#e63946] focus:ring-[#e63946]"
                                />
                            </label>

                            {/* Cân chỉnh ảnh in */}
                            <div className="border-t border-gray-100 pt-4 mt-4 space-y-4">
                                <span className="block text-sm font-bold text-[#1a1a2e]">Cân chỉnh lệch ảnh & Tỉ lệ in</span>
                                <div className="grid grid-cols-2 gap-4">
                                    <label className="block">
                                        <span className="mb-2 block text-xs font-bold text-gray-500">Tỉ lệ rộng (%)</span>
                                        <input
                                            type="number"
                                            name="print_scale_x"
                                            value={configs.print_scale_x ?? 100}
                                            onChange={handleChange}
                                            className="block w-full rounded-xl border-gray-200 px-4 py-2.5 text-xs focus:border-[#e63946]"
                                            min="50" max="150"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="mb-2 block text-xs font-bold text-gray-500">Tỉ lệ cao (%)</span>
                                        <input
                                            type="number"
                                            name="print_scale_y"
                                            value={configs.print_scale_y ?? 100}
                                            onChange={handleChange}
                                            className="block w-full rounded-xl border-gray-200 px-4 py-2.5 text-xs focus:border-[#e63946]"
                                            min="50" max="150"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="mb-2 block text-xs font-bold text-gray-500">Dịch ngang X (px)</span>
                                        <input
                                            type="number"
                                            name="print_offset_x"
                                            value={configs.print_offset_x ?? 0}
                                            onChange={handleChange}
                                            className="block w-full rounded-xl border-gray-200 px-4 py-2.5 text-xs focus:border-[#e63946]"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="mb-2 block text-xs font-bold text-gray-500">Dịch dọc Y (px)</span>
                                        <input
                                            type="number"
                                            name="print_offset_y"
                                            value={configs.print_offset_y ?? 0}
                                            onChange={handleChange}
                                            className="block w-full rounded-xl border-gray-200 px-4 py-2.5 text-xs focus:border-[#e63946]"
                                        />
                                    </label>
                                </div>
                                <p className="text-[10px] text-gray-400 font-semibold leading-normal">
                                    * Tăng X / Y để dịch chuyển ảnh in sang phải / xuống dưới.
                                </p>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm lg:col-span-2">
                        <div className="mb-6 flex items-center justify-between gap-4">
                            <div>
                                <h2 className="text-xl font-bold text-[#1a1a2e]">Thời gian</h2>
                                <p className="mt-1 text-sm text-[#e63946]">Cấu hình thời lượng phiên và thời gian chờ camera.</p>
                            </div>
                            <SettingsIcon className="text-[#e63946]" size={24} />
                        </div>

                        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                            <label className="block">
                                <span className="mb-2 block text-sm font-bold text-gray-700">Thời gian 1 phiên chụp (giây)</span>
                                <input type="number" min="30" name="session_timeout" value={configs.session_timeout} onChange={handleChange} className="block w-full rounded-xl border-gray-200 px-4 py-3 text-sm focus:border-[#e63946] focus:ring-[#e63946]" />
                            </label>

                            <label className="block">
                                <span className="mb-2 block text-sm font-bold text-gray-700">Đếm ngược mỗi ảnh (giây)</span>
                                <input type="number" min="1" name="countdown" value={configs.countdown} onChange={handleChange} className="block w-full rounded-xl border-gray-200 px-4 py-3 text-sm focus:border-[#e63946] focus:ring-[#e63946]" />
                            </label>

                            <label className="block">
                                <span className="mb-2 block text-sm font-bold text-gray-700">Thời gian tải ảnh điện thoại (giây)</span>
                                <input type="number" min="30" name="mobile_session_timeout" value={configs.mobile_session_timeout} onChange={handleChange} className="block w-full rounded-xl border-gray-200 px-4 py-3 text-sm focus:border-[#e63946] focus:ring-[#e63946]" />
                            </label>

                            <label className="block">
                                <span className="mb-2 block text-sm font-bold text-gray-700">Chờ ảnh Hot Folder (giây)</span>
                                <input type="number" min="5" name="hotfolder_capture_timeout" value={configs.hotfolder_capture_timeout} onChange={handleChange} className="block w-full rounded-xl border-gray-200 px-4 py-3 text-sm focus:border-[#e63946] focus:ring-[#e63946]" />
                            </label>

                            <label className="block">
                                <span className="mb-2 block text-sm font-bold text-gray-700">Chờ ảnh Canon middleware (giây)</span>
                                <input type="number" min="5" name="canon_capture_timeout" value={configs.canon_capture_timeout} onChange={handleChange} className="block w-full rounded-xl border-gray-200 px-4 py-3 text-sm focus:border-[#e63946] focus:ring-[#e63946]" />
                            </label>
                        </div>
                    </section>

                    {renderPrintColorControls()}

                    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="mb-6 flex items-center justify-between gap-4">
                            <div>
                                <h2 className="text-xl font-bold text-[#1a1a2e]">Máy ảnh</h2>
                                <p className="mt-1 text-sm text-[#e63946]">Chọn cách máy booth nhận ảnh từ camera.</p>
                            </div>
                            <SettingsIcon className="text-[#e63946]" size={24} />
                        </div>

                        <div className="space-y-5">
                            <label className="block">
                                <span className="mb-2 block text-sm font-bold text-gray-700">Chế độ camera</span>
                                <select
                                    name="camera_mode"
                                    value={configs.camera_mode}
                                    onChange={handleChange}
                                    className="block w-full rounded-xl border-gray-200 px-4 py-3 text-sm focus:border-[#e63946] focus:ring-[#e63946]"
                                >
                                    <option value="canon">Canon middleware</option>
                                    <option value="hotfolder">Hot folder / EOS Utility</option>
                                </select>
                            </label>

                            {configs.camera_mode === 'hotfolder' && (
                                <div className="rounded-2xl border border-orange-100 bg-orange-50 p-5">
                                    <label className="block">
                                        <span className="mb-2 block text-sm font-bold text-gray-700">Thư mục nhận ảnh</span>
                                        <input
                                            type="text"
                                            name="hot_folder"
                                            value={configs.hot_folder}
                                            onChange={handleChange}
                                            placeholder="C:/Photobooth_Input"
                                            className="block w-full rounded-xl border-orange-200 px-4 py-3 text-sm focus:border-orange-400 focus:ring-orange-400"
                                        />
                                    </label>

                                    <label className="mt-4 block">
                                        <span className="mb-2 block text-sm font-bold text-gray-700">Phím chụp</span>
                                        <input
                                            type="text"
                                            name="trigger_key"
                                            value={configs.trigger_key}
                                            onChange={handleChange}
                                            placeholder="{F8}"
                                            className="block w-full rounded-xl border-orange-200 px-4 py-3 text-sm font-mono focus:border-orange-400 focus:ring-orange-400"
                                        />
                                    </label>
                                </div>
                            )}

                            {configs.camera_mode === 'canon' && (
                                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm leading-6 text-blue-700">
                                    Cần chạy Canon middleware trên máy local. LiveView và capture dùng cổng
                                    <span className="font-mono font-bold"> http://localhost:5001</span>.
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                <div className="flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className={`flex items-center justify-center gap-2 rounded-xl px-8 py-3 font-bold text-white shadow-lg shadow-[#e63946]/20 transition-all duration-200 ${saving ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#e63946] hover:bg-[#3f6154]'}`}
                    >
                        {saving ? (
                            <>
                                <RefreshCw size={20} className="animate-spin" />
                                Đang lưu...
                            </>
                        ) : (
                            <>
                                <Save size={20} />
                                Lưu cấu hình phần cứng
                            </>
                        )}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col lg:flex-row gap-6 lg:h-[calc(100vh-6rem)] w-full max-w-full overflow-hidden animate-fadeIn">
            {/* Left Sidebar: Navigation & Header */}
            <div className="w-full lg:w-64 flex-shrink-0 flex flex-col gap-6">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-[#1a1a2e] tracking-tight">Cài đặt & Thiết bị</h1>
                    <p className="text-gray-500 mt-1 text-sm md:text-base">Quản lý cấu hình hệ thống và các thiết bị kết nối.</p>
                </div>

                {isLocalAdmin && (
                    <nav className="space-y-2">
                        <button
                            onClick={() => setActiveTab('general')}
                            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-bold transition-all text-left ${activeTab === 'general'
                                ? 'bg-[#e63946] text-white shadow-md shadow-[#e63946]/10'
                                : 'text-gray-500 hover:bg-gray-50 hover:text-[#e63946]'
                                }`}
                        >
                            <SettingsIcon size={20} />
                            Cài đặt chung
                        </button>

                        <button
                            onClick={() => setActiveTab('devices')}
                            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-bold transition-all text-left ${activeTab === 'devices'
                                ? 'bg-[#e63946] text-white shadow-md shadow-[#e63946]/10'
                                : 'text-gray-500 hover:bg-gray-50 hover:text-[#e63946]'
                                }`}
                        >
                            <Monitor size={20} />
                            Quản lý Thiết bị
                        </button>
                    </nav>
                )}
            </div>

            {/* Right Content Area */}
            <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                {activeTab === 'general' ? (
                    <div className="h-full flex flex-col">
                        <div className="p-4 sm:p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <h2 className="text-xl font-bold text-[#1a1a2e] flex items-center gap-2">
                                <SettingsIcon size={20} className="text-[#e63946]" />
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

                        <div className="flex-1 lg:overflow-y-auto overflow-x-hidden p-4 sm:p-8">
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
                                    <div className="flex items-center justify-between border-b pb-2">
                                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Thanh toán & In ấn</h3>
                                        {isLocalAdmin && (
                                            <div className="flex items-center gap-3">
                                                <span className="text-sm font-bold text-gray-600">
                                                    Chế độ hoạt động:
                                                </span>
                                                <button
                                                    onClick={toggleEventMode}
                                                    className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase transition-all shadow-sm flex items-center gap-2 ${
                                                        isEventMode 
                                                            ? 'bg-purple-500 text-white hover:bg-purple-600' 
                                                            : 'bg-blue-500 text-white hover:bg-blue-600'
                                                    }`}
                                                >
                                                    {isEventMode ? (
                                                        <>Sự kiện <Zap size={14} /></>
                                                    ) : (
                                                        <>Trả phí <DollarSign size={14} /></>
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Kiosk Flow */}
                                        <div className="bg-gray-50/80 p-4 sm:p-6 rounded-2xl border border-gray-100 space-y-6">
                                            <h4 className="text-base font-bold text-[#354f52] flex items-center gap-2 tracking-wide">
                                                📸 Chụp tại quầy
                                            </h4>

                                            <div className="group">
                                                <label className="block text-xs font-bold text-gray-700 mb-2">
                                                    Giá mỗi lượt chụp
                                                </label>
                                                <div className="relative rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-[#e63946]/20">
                                                    <input type="number" name="price" value={configs.price} onChange={handleChange} className="block w-full rounded-xl border-gray-200 pl-4 pr-12 py-2.5 text-sm focus:border-[#e63946]" />
                                                    <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                                                        <span className="text-gray-400 font-bold text-xs uppercase">VND</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="group">
                                                <label className="block text-xs font-bold text-gray-700 mb-2">
                                                    Giá bản in thêm
                                                </label>
                                                <div className="relative rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-[#e63946]/20">
                                                    <input type="number" name="print_price" value={configs.print_price} onChange={handleChange} className="block w-full rounded-xl border-gray-200 pl-4 pr-12 py-2.5 text-sm focus:border-[#e63946]" />
                                                    <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                                                        <span className="text-gray-400 font-bold text-xs uppercase">VND</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {isLocalAdmin && (
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
                                                        className="block w-full rounded-xl border-gray-200 px-4 py-2.5 text-sm focus:border-[#e63946]"
                                                    />
                                                    <p className="mt-2 text-xs text-gray-400">Ví dụ: RX1HS, DNP DS-RX1HS, DS-RX1.</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Mobile Upload Flow */}
                                        <div className="bg-[#f8fcf3] p-4 sm:p-6 rounded-2xl border border-[#e6eedf] space-y-6">
                                            <h4 className="text-base font-bold text-[#e63946] flex items-center gap-2 tracking-wide">
                                                📱 Tải trực tuyến
                                            </h4>

                                            <div className="group">
                                                <label className="block text-xs font-bold text-[#e63946] mb-2">
                                                    Giá mỗi phiên tải
                                                </label>
                                                <div className="relative rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-[#e63946]/20">
                                                    <input type="number" name="mobile_price" value={configs.mobile_price} onChange={handleChange} className="block w-full rounded-xl border-[#e6eedf] pl-4 pr-12 py-2.5 text-sm focus:border-[#e63946]" />
                                                    <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                                                        <span className="text-gray-400 font-bold text-xs uppercase">VND</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="group">
                                                <label className="block text-xs font-bold text-[#e63946] mb-2">
                                                    Giá bản in thêm
                                                </label>
                                                <div className="relative rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-[#e63946]/20">
                                                    <input type="number" name="mobile_print_price" value={configs.mobile_print_price} onChange={handleChange} className="block w-full rounded-xl border-[#e6eedf] pl-4 pr-12 py-2.5 text-sm focus:border-[#e63946]" />
                                                    <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                                                        <span className="text-gray-400 font-bold text-xs uppercase">VND</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Cân chỉnh ảnh in */}
                                        {isLocalAdmin && (
                                            <div className="bg-white p-4 sm:p-6 rounded-2xl border border-gray-100 space-y-6 shadow-sm col-span-1 md:col-span-2">
                                                <h4 className="text-base font-bold text-[#e63946] flex items-center gap-2 tracking-wide">
                                                    🖨️ Cân chỉnh tỉ lệ & Lệch ảnh in
                                                </h4>
                                                <p className="text-xs text-gray-500 font-semibold">
                                                    Điều chỉnh tỉ lệ co giãn (Scale) và vị trí dịch chuyển (Offset) của ảnh vẽ ra máy in nếu bản in thực tế bị cắt lệch viền.
                                                </p>
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-2">
                                                            Tỉ lệ rộng (%)
                                                        </label>
                                                        <input 
                                                            type="number" 
                                                            name="print_scale_x" 
                                                            value={configs.print_scale_x ?? 100} 
                                                            onChange={handleChange} 
                                                            className="block w-full rounded-xl border-gray-200 py-2.5 px-4 text-sm" 
                                                            min="50" max="150"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-2">
                                                            Tỉ lệ cao (%)
                                                        </label>
                                                        <input 
                                                            type="number" 
                                                            name="print_scale_y" 
                                                            value={configs.print_scale_y ?? 100} 
                                                            onChange={handleChange} 
                                                            className="block w-full rounded-xl border-gray-200 py-2.5 px-4 text-sm" 
                                                            min="50" max="150"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-2">
                                                            Dịch ngang X (pixel)
                                                        </label>
                                                        <input 
                                                            type="number" 
                                                            name="print_offset_x" 
                                                            value={configs.print_offset_x ?? 0} 
                                                            onChange={handleChange} 
                                                            className="block w-full rounded-xl border-gray-200 py-2.5 px-4 text-sm" 
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-700 mb-2">
                                                            Dịch dọc Y (pixel)
                                                        </label>
                                                        <input 
                                                            type="number" 
                                                            name="print_offset_y" 
                                                            value={configs.print_offset_y ?? 0} 
                                                            onChange={handleChange} 
                                                            className="block w-full rounded-xl border-gray-200 py-2.5 px-4 text-sm" 
                                                        />
                                                    </div>
                                                </div>
                                                <p className="text-[11px] text-gray-400">
                                                    * Mẹo: Nếu ảnh in bị cắt lệch về bên trái/phía trên, hãy tăng Dịch ngang X / Dịch dọc Y để dịch chuyển ảnh in sang phải/xuống dưới. Nếu ảnh bị co quá mức, hãy giảm tỉ lệ rộng/cao.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>


                                    <div className="rounded-2xl border border-[#E7D3B7] bg-white p-4 sm:p-6 shadow-sm min-w-0 max-w-full overflow-hidden">
                                        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                                            <div>
                                                <h4 className="text-base font-bold text-[#354f52]">Hẹn giờ đổi giá</h4>
                                                <p className="text-xs font-semibold text-gray-500">Lưu trên cloud và tự động đồng bộ xuống máy local.</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={addPriceSchedule}
                                                className="rounded-full bg-[#e63946] px-5 py-2 text-sm font-black text-white"
                                            >
                                                Thêm lịch
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                                            <input
                                                type="datetime-local"
                                                value={priceScheduleForm.run_at}
                                                onChange={(event) => setPriceScheduleForm((prev) => ({ ...prev, run_at: event.target.value }))}
                                                className="w-full max-w-full min-w-0 box-border rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-xs md:text-sm focus:border-[#e63946] focus:outline-none focus:ring-2 focus:ring-[#e63946]/20 transition-all text-[#1a1a2e]"
                                            />
                                            {[
                                                ['price', 'Giá chụp'],
                                                ['print_price', 'In thêm'],
                                                ['mobile_price', 'Mobile'],
                                                ['mobile_print_price', 'Mobile in thêm'],
                                            ].map(([key, label]) => (
                                                <input
                                                    key={key}
                                                    type="number"
                                                    placeholder={label}
                                                    value={priceScheduleForm[key]}
                                                    onChange={(event) => setPriceScheduleForm((prev) => ({ ...prev, [key]: event.target.value }))}
                                                    className="w-full max-w-full min-w-0 box-border rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-xs md:text-sm focus:border-[#e63946] focus:outline-none focus:ring-2 focus:ring-[#e63946]/20 transition-all text-[#1a1a2e]"
                                                />
                                            ))}
                                        </div>

                                        <label className="mt-3 flex items-center gap-2 text-xs sm:text-sm font-bold text-[#1a1a2e] cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={!!priceScheduleForm.repeat}
                                                onChange={(event) => setPriceScheduleForm((prev) => ({ ...prev, repeat: event.target.checked }))}
                                                className="h-4 w-4 accent-[#e63946]"
                                            />
                                            🔁 Lặp lại mỗi ngày (vào đúng giờ đã chọn, tới khi xóa)
                                        </label>

                                        <div className="mt-5 space-y-2">
                                            {getPriceSchedule().length === 0 ? (
                                                <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-500">Chưa có lịch đổi giá.</div>
                                            ) : getPriceSchedule().map((item, index) => (
                                                <div key={item.id || index} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 sm:px-4 sm:py-3">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex flex-wrap items-center gap-1.5 font-black text-xs sm:text-sm text-[#1a1a2e]">
                                                            {item.repeat === 'daily' ? (
                                                                <>
                                                                    <span>🔁 Hằng ngày lúc {isNaN(new Date(item.run_at)) ? (item.run_at || '--') : new Date(item.run_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
                                                                    <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700 font-bold whitespace-nowrap">Lặp lại mỗi ngày</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <span>{isNaN(new Date(item.run_at)) ? item.run_at || 'Chưa chọn ngày' : new Date(item.run_at).toLocaleString('vi-VN')}</span>
                                                                    {item.applied ? (
                                                                        <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-[10px] text-green-700 font-bold whitespace-nowrap">Đã áp dụng</span>
                                                                    ) : (
                                                                        <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 font-bold whitespace-nowrap">Đang chờ</span>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-semibold text-gray-500">
                                                            <span className="whitespace-nowrap">Chụp: <strong className="text-gray-700">{Number(item.price || 0).toLocaleString('vi-VN')}đ</strong></span>
                                                            <span className="text-gray-300">•</span>
                                                            <span className="whitespace-nowrap">In: <strong className="text-gray-700">{Number(item.print_price || 0).toLocaleString('vi-VN')}đ</strong></span>
                                                            <span className="text-gray-300">•</span>
                                                            <span className="whitespace-nowrap">Mobile: <strong className="text-gray-700">{Number(item.mobile_price || 0).toLocaleString('vi-VN')}đ</strong></span>
                                                            <span className="text-gray-300">•</span>
                                                            <span className="whitespace-nowrap">Mb in: <strong className="text-gray-700">{Number(item.mobile_print_price || 0).toLocaleString('vi-VN')}đ</strong></span>
                                                        </div>
                                                    </div>
                                                    <div className="flex justify-end w-full sm:w-auto border-t sm:border-0 pt-2 sm:pt-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => removePriceSchedule(index)}
                                                            className="rounded-lg border border-red-100 bg-white px-3 py-1.5 text-xs font-black text-red-600 hover:bg-red-50 active:scale-95 transition-all w-full sm:w-auto text-center"
                                                        >
                                                            Xóa
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>                                {/* SECTION 2: THỜI GIAN CHỤP */}
                                <div className="space-y-4">
                                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider border-b pb-2">Thời gian & Trải nghiệm</h3>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="bg-white p-4 sm:p-6 rounded-2xl border border-gray-100 space-y-6 shadow-sm">
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
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-2">
                                                    Chờ ảnh Hot Folder (giây)
                                                </label>
                                                <input type="number" name="hotfolder_capture_timeout" value={configs.hotfolder_capture_timeout} onChange={handleChange} className="block w-full rounded-xl border-gray-200 py-2.5 px-4 text-sm" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-2">
                                                    Chờ ảnh Canon middleware (giây)
                                                </label>
                                                <input type="number" name="canon_capture_timeout" value={configs.canon_capture_timeout} onChange={handleChange} className="block w-full rounded-xl border-gray-200 py-2.5 px-4 text-sm" />
                                            </div>
                                        </div>

                                        <div className="bg-white p-4 sm:p-6 rounded-2xl border border-gray-100 space-y-6 shadow-sm">
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
                                {isLocalAdmin && (
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
                                                    className="block w-full rounded-xl border-gray-200 pl-4 pr-10 py-3 focus:border-[#e63946] focus:ring-[#e63946] bg-white"
                                                >
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
                                                    LiveView và Capture sẽ hoạt động qua cổng <code>http://localhost:5001</code>.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Footer Action */}
                        <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-end">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className={`
                                    flex items-center justify-center gap-2 px-8 py-3 rounded-xl font-bold text-white shadow-lg shadow-[#e63946]/20
                                    ${saving ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#e63946] hover:bg-[#3f6154] hover:shadow-xl hover:scale-[1.02]'}
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
                    <div className="h-full lg:overflow-y-auto overflow-x-hidden p-8">
                        <DeviceManager />
                    </div>
                )}
            </div>
        </div>
    );
};

export default Settings;
