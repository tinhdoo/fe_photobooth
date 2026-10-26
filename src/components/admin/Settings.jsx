import { useState, useEffect } from 'react';
import axios from 'axios';
import { Camera, CheckCircle2, Printer, Save, RefreshCw, Settings as SettingsIcon, Monitor, Wifi, XCircle, Banknote, Trash2, Plus, ChevronDown } from 'lucide-react';
import DeviceManager from './DeviceManager';
import { isLocalHost } from '../../utils/runtime';
import { authHeader } from '../../utils/auth';

// Cloud chỉ cho admin đã đăng nhập lưu cấu hình (từ 2026-10-06). Lỗi quyền -> nói rõ, không chỉ "Lỗi".
const loiLuuCauHinh = (error, macDinh) => ([401, 403].includes(error?.response?.status)
    ? 'Không có quyền lưu: đăng nhập lại bằng tài khoản admin trên trang quản lý cloud.'
    : macDinh);

const Settings = ({ forceLocalAdmin = false }) => {
    const isLocalAdmin = isLocalHost() || forceLocalAdmin;
    const [activeTab, setActiveTab] = useState('general');
    const [configs, setConfigs] = useState({
        price: '60000',
        print_price: '20000',
        mobile_price: '30000',
        mobile_print_price: '10000',
        session_timeout: '600',
        mobile_session_timeout: '300',
        session_capture_timeout: '300',
        session_review_timeout: '120',
        session_frame_timeout: '180',
        id_studio_timeout: '300',
        countdown: '5',
        hotfolder_capture_timeout: '30',
        canon_capture_timeout: '30',
        printer_name: 'RX1HS',
        printer_copies: '1',
        printer_check_before_pay: 'true',
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
        print_offset_y: '0',
        mode_switch_password: '',
        photo_edit_enabled: 'false',
        photo_edit_timeout: '200',
        id_photo_price: '',
        id_photo_print_price: '',
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
    const [moFormLich, setMoFormLich] = useState(false); // form thêm lịch đổi giá: chỉ mở khi bấm "Thêm lịch"

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
                // Merge with defaults to ensure keys exist. Booth local CHỈ dùng Canon middleware ->
                // cố định camera_mode='canon' (đã bỏ ô chọn chế độ) để không kẹt ở hotfolder khi lưu.
                setConfigs(prev => ({
                    ...prev,
                    ...res.data,
                    ...(isLocalAdmin ? { camera_mode: 'canon' } : {}),
                }));
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

    // Tăng/giảm 1 giá trị số theo bước, có kẹp min/max. Dùng cho nút − / + (bấm dễ trên cảm ứng).
    const stepConfig = (name, delta, min, max) => {
        setConfigs((prev) => {
            const cur = parseFloat(prev[name]);
            let next = (Number.isNaN(cur) ? 0 : cur) + delta;
            if (min !== undefined && next < min) next = min;
            if (max !== undefined && next > max) next = max;
            return { ...prev, [name]: String(next) };
        });
    };

    // Ô số kèm nút − / + hai bên -> thao tác chính xác bằng ngón tay, không cần kéo slider/gõ số.
    const renderStepper = (name, { min, max, step = 1 } = {}) => (
        <div className="inline-flex items-stretch overflow-hidden rounded-xl border border-[#ead8bd]">
            <button
                type="button"
                onClick={() => stepConfig(name, -step, min, max)}
                className="w-12 bg-[#fffaf0] text-2xl font-black leading-none text-[#7B5E43] active:bg-[#f3e4cf]"
                aria-label="Giảm"
            >
                -
            </button>
            <input
                type="number"
                name={name}
                min={min}
                max={max}
                step={step}
                value={configs[name] ?? 0}
                onChange={handleChange}
                className="h-12 w-16 border-x border-[#ead8bd] bg-white text-center text-base font-bold text-[#7B5E43] focus:outline-none"
            />
            <button
                type="button"
                onClick={() => stepConfig(name, step, min, max)}
                className="w-12 bg-[#fffaf0] text-2xl font-black leading-none text-[#7B5E43] active:bg-[#f3e4cf]"
                aria-label="Tăng"
            >
                +
            </button>
        </div>
    );

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            // Booth bản cũ (<= 0.0.29) chỉ đọc một đồng hồ chung session_timeout: ghi bằng tổng Chụp + Chọn ảnh + Chọn
            // khung (không tính Chỉnh ảnh: bản cũ dừng đồng hồ phiên ở bước đó) để booth chưa cập nhật có cùng tổng giờ.
            const giay = (k, d) => parseInt(configs[k], 10) || d;
            const tong = giay('session_capture_timeout', 300) + giay('session_review_timeout', 120)
                + giay('session_frame_timeout', 180);
            await axios.post('/api/config', { ...configs, session_timeout: String(tong) }, { headers: authHeader() });
            setConfigs((prev) => ({ ...prev, session_timeout: String(tong) }));
            setMessage({ type: 'success', text: 'Cài đặt đã được lưu thành công!' });
        } catch (error) {
            console.error("Error saving configs:", error);
            setMessage({ type: 'error', text: loiLuuCauHinh(error, 'Lỗi khi lưu cài đặt.') });
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
            await axios.post('/api/config', { price_schedule: JSON.stringify(schedule) }, { headers: authHeader() });
        } catch (error) {
            console.error('Lưu lịch giá thất bại:', error);
            setMessage({ type: 'error', text: loiLuuCauHinh(error, 'Lưu lịch giá thất bại, thử lại.') });
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
                    <div key={control.name} className="rounded-2xl border border-[#ead8bd] bg-white p-4">
                        <div className="mb-3 flex items-center justify-between gap-4">
                            <span className="text-sm font-extrabold text-[#1a1a2e]">{control.label}</span>
                            {renderStepper(control.name, { min: control.min, max: control.max, step: control.step })}
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
                    </div>
                ))}
            </div>
        </section>
    );

    if (isLocalAdmin) {
        const printer = hardware?.printer || {};
        const camera = hardware?.camera || {};
        const bill = hardware?.bill || {};
        // Máy đọc tiền kết nối THEO NHU CẦU: lúc rảnh cổng đóng ('idle') là bình thường, không phải lỗi.
        const billOk = !bill.enabled || bill.status === 'connected' || bill.status === 'idle';
        const billText = !bill.enabled ? 'Đang tắt'
            : bill.status === 'connected' ? 'Đã kết nối'
            : bill.status === 'idle' ? 'Sẵn sàng (mở khi khách chọn tiền mặt)'
            : bill.status === 'stuck' ? 'Treo — rút cắm lại USB'
            : 'Mất kết nối';
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

                <h3 className="border-b border-[#ead8bd] pb-2 text-sm font-bold uppercase tracking-wider text-gray-400">Trạng thái thiết bị</h3>

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
                                    {billText}
                                </span>
                            </div>
                            <div className="rounded-2xl bg-[#F8F3E7] p-4 text-sm leading-6 text-[#1a1a2e]">
                                <div className="flex justify-between gap-4">
                                    <span className="font-bold text-gray-500">Trạng thái cấu hình</span>
                                    <span className="text-right font-bold">{bill.enabled ? 'Bật' : 'Tắt'}</span>
                                </div>
                                <div className="mt-3 flex justify-between gap-4">
                                    <span className="font-bold text-gray-500">Tình trạng kết nối</span>
                                    <span className="text-right font-bold">{billOk ? 'OK' : 'Lỗi'}</span>
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

                <h3 className="border-b border-[#ead8bd] pb-2 text-sm font-bold uppercase tracking-wider text-gray-400">Cấu hình thiết bị</h3>

                <div className="space-y-6">
                    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="mb-6 flex items-center justify-between gap-4">
                            <div>
                                <h2 className="text-xl font-bold text-[#1a1a2e]">Cấu hình máy in</h2>
                                <p className="mt-1 text-sm text-[#e63946]">Dùng cho DNP RX1HS hoặc máy in Windows tương thích.</p>
                            </div>
                            <Monitor className="text-[#e63946]" size={24} />
                        </div>

                        <div className="space-y-5">
                            <div className="grid gap-5 md:grid-cols-2">
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
                            </div>

                            {/* Chỉ có tác dụng trên booth (backend local đọc); cấu hình cloud không đồng bộ khoá này. */}
                            {isLocalAdmin && (
                                <label className="flex cursor-pointer select-none items-start gap-3 rounded-xl bg-gray-50 px-4 py-3">
                                    <input
                                        type="checkbox"
                                        checked={String(configs.printer_check_before_pay ?? 'true') !== 'false'}
                                        onChange={(e) => setConfigs((prev) => ({ ...prev, printer_check_before_pay: e.target.checked ? 'true' : 'false' }))}
                                        className="mt-0.5 h-4 w-4 accent-[#e63946]"
                                    />
                                    <span>
                                        <span className="block text-sm font-bold text-gray-700">Kiểm tra máy in &amp; giấy trước khi khách trả tiền</span>
                                        <span className="mt-1 block text-xs text-gray-500">
                                            Máy in tắt, báo lỗi hoặc không đủ giấy thì màn Thanh toán báo gọi nhân viên thay vì thu tiền.
                                            Chỉ tắt khi máy in báo sai trạng thái làm khách không trả tiền được.
                                        </span>
                                    </span>
                                </label>
                            )}

                            {/* Cân chỉnh ảnh in */}
                            <div className="border-t border-gray-100 pt-4 mt-4 space-y-4">
                                <span className="block text-sm font-bold text-[#1a1a2e]">Cân chỉnh lệch ảnh & Tỉ lệ in</span>
                                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                                    <div>
                                        <span className="mb-2 block text-xs font-bold text-gray-500">Tỉ lệ rộng (%)</span>
                                        {renderStepper('print_scale_x', { min: 50, max: 150, step: 1 })}
                                    </div>
                                    <div>
                                        <span className="mb-2 block text-xs font-bold text-gray-500">Tỉ lệ cao (%)</span>
                                        {renderStepper('print_scale_y', { min: 50, max: 150, step: 1 })}
                                    </div>
                                    <div>
                                        <span className="mb-2 block text-xs font-bold text-gray-500">Dịch ngang X (px)</span>
                                        {renderStepper('print_offset_x', { step: 2 })}
                                    </div>
                                    <div>
                                        <span className="mb-2 block text-xs font-bold text-gray-500">Dịch dọc Y (px)</span>
                                        {renderStepper('print_offset_y', { step: 2 })}
                                    </div>
                                </div>
                                <p className="text-[10px] text-gray-400 font-semibold leading-normal">
                                    * Tăng X / Y để dịch chuyển ảnh in sang phải / xuống dưới.
                                </p>
                            </div>
                        </div>
                    </section>

                    {renderPrintColorControls()}
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

    // ---- Trang Cài đặt trên cloud (máy booth đã return trang phần cứng ở trên) ----
    // Gọn cho điện thoại: mỗi nhóm một khối nhỏ, ô nhập thấp, giá xếp thành bảng 2x2 thay vì 2 thẻ to.
    const oNhap = 'block w-full min-w-0 rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2.5 text-sm font-bold text-[#1a1a2e] transition-all focus:border-[#e63946] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#e63946]/20';
    const oGia = (name, placeholder) => (
        <div className="relative">
            <input type="number" inputMode="numeric" name={name} value={configs[name] ?? ''} onChange={handleChange} placeholder={placeholder} className={`${oNhap} pr-7`} />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-gray-400">đ</span>
        </div>
    );
    const oGiay = (name, nhan, placeholder, min = 10) => (
        <label className="block min-w-0">
            <span className="mb-1.5 block truncate text-xs font-semibold text-gray-600">{nhan}</span>
            <input type="number" inputMode="numeric" name={name} min={min} placeholder={placeholder} value={configs[name] ?? ''} onChange={handleChange} className={oNhap} />
        </label>
    );
    const khoi = (tieuDe, noiDung, phai = null) => (
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-3 flex min-h-[32px] items-center justify-between gap-3">
                <h2 className="text-base font-bold text-[#1a1a2e]">{tieuDe}</h2>
                {phai}
            </div>
            {noiDung}
        </section>
    );
    const gioLich = (item) => (isNaN(new Date(item.run_at))
        ? (item.run_at || '--')
        : item.repeat === 'daily'
            ? new Date(item.run_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
            : (() => { const d = new Date(item.run_at); const h = (n) => String(n).padStart(2, '0'); return `${h(d.getHours())}:${h(d.getMinutes())} · ${h(d.getDate())}/${h(d.getMonth() + 1)}`; })());
    const chinhAnhBat = String(configs.photo_edit_enabled) === 'true';
    const lich = getPriceSchedule();

    return (
        <div className="animate-fadeIn">
            <div className="mb-4 flex items-center justify-between gap-3 lg:mb-6">
                <h1 className="text-2xl font-bold tracking-tight text-[#1a1a2e] md:text-3xl">Cài đặt & Thiết bị</h1>
                {activeTab === 'general' && (
                    <button
                        type="button"
                        onClick={fetchConfigs}
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gray-200 bg-white text-gray-500 transition-all hover:text-gray-700 active:scale-95"
                        title="Tải lại cấu hình"
                    >
                        <RefreshCw size={18} />
                    </button>
                )}
            </div>

            <nav className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-gray-100 p-1 sm:inline-grid sm:min-w-[360px]">
                {[['general', 'Cài đặt chung', SettingsIcon], ['devices', 'Thiết bị', Monitor]].map(([k, ten, Icon]) => (
                    <button
                        key={k}
                        type="button"
                        onClick={() => setActiveTab(k)}
                        className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-all ${activeTab === k ? 'bg-white text-[#e63946] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Icon size={16} /> {ten}
                    </button>
                ))}
            </nav>

            {activeTab === 'general' ? (
                <div className="space-y-4">
                    {message && (
                        <div className={`animate-fadeIn rounded-xl border p-3 text-sm font-bold ${message.type === 'success' ? 'border-green-100 bg-green-50 text-green-700' : 'border-red-100 bg-red-50 text-red-700'}`}>
                            {message.text}
                        </div>
                    )}

                    <div className="grid gap-4 lg:grid-cols-2">
                        {khoi('Giá', (
                            <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-2">
                                <span />
                                <span className="text-[11px] font-semibold text-gray-400">Mỗi lượt</span>
                                <span className="text-[11px] font-semibold text-gray-400">In thêm 1 tờ</span>
                                <span className="pr-1 text-sm font-bold text-[#1a1a2e]">Photobooth</span>
                                {oGia('price')}
                                {oGia('print_price')}
                                <span className="pr-1 text-sm font-bold text-[#1a1a2e]">Ảnh thẻ</span>
                                {oGia('id_photo_price', 'Như trên')}
                                {oGia('id_photo_print_price', 'Như trên')}
                            </div>
                        ))}

                        {khoi('Hẹn giờ đổi giá', (
                            <div className="space-y-2">
                                {moFormLich && (
                                    <div className="space-y-2 rounded-xl border border-[#e63946]/20 bg-[#e63946]/[0.03] p-3">
                                        <input
                                            type="datetime-local"
                                            value={priceScheduleForm.run_at}
                                            onChange={(e) => setPriceScheduleForm((prev) => ({ ...prev, run_at: e.target.value }))}
                                            className={oNhap}
                                        />
                                        <div className="grid grid-cols-2 gap-2">
                                            {[['price', `Giá chụp (${configs.price})`], ['print_price', `In thêm (${configs.print_price})`]].map(([key, nhan]) => (
                                                <input
                                                    key={key}
                                                    type="number"
                                                    inputMode="numeric"
                                                    placeholder={nhan}
                                                    value={priceScheduleForm[key]}
                                                    onChange={(e) => setPriceScheduleForm((prev) => ({ ...prev, [key]: e.target.value }))}
                                                    className={oNhap}
                                                />
                                            ))}
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-semibold text-gray-700">
                                                <input
                                                    type="checkbox"
                                                    checked={!!priceScheduleForm.repeat}
                                                    onChange={(e) => setPriceScheduleForm((prev) => ({ ...prev, repeat: e.target.checked }))}
                                                    className="h-4 w-4 accent-[#e63946]"
                                                />
                                                Lặp lại mỗi ngày
                                            </label>
                                            <div className="flex gap-2">
                                                <button type="button" onClick={() => setMoFormLich(false)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100">Huỷ</button>
                                                <button
                                                    type="button"
                                                    onClick={() => { if (priceScheduleForm.run_at) setMoFormLich(false); addPriceSchedule(); }}
                                                    className="rounded-lg bg-[#e63946] px-4 py-1.5 text-xs font-bold text-white active:scale-95"
                                                >
                                                    Thêm
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {lich.length === 0 ? (
                                    !moFormLich && <p className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-400">Chưa có lịch.</p>
                                ) : (
                                    <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">
                                        {lich.map((item, index) => (
                                            <div key={item.id || index} className="flex items-center gap-3 px-3 py-2.5">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-[#1a1a2e]">
                                                        {item.repeat === 'daily' ? `Hằng ngày ${gioLich(item)}` : gioLich(item)}
                                                        {item.repeat === 'daily'
                                                            ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">Lặp lại</span>
                                                            : item.applied
                                                                ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">Đã áp dụng</span>
                                                                : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Đang chờ</span>}
                                                    </div>
                                                    <div className="mt-0.5 text-xs text-gray-500">
                                                        Chụp {Number(item.price || 0).toLocaleString('vi-VN')}đ · In {Number(item.print_price || 0).toLocaleString('vi-VN')}đ
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removePriceSchedule(index)}
                                                    aria-label="Xoá lịch"
                                                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-gray-400 transition-all hover:bg-red-50 hover:text-red-600 active:scale-95"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ), !moFormLich && (
                            <button
                                type="button"
                                onClick={() => setMoFormLich(true)}
                                className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-bold text-[#e63946] transition-all hover:border-[#e63946]/40 active:scale-95"
                            >
                                <Plus size={14} /> Thêm lịch
                            </button>
                        ))}
                    </div>

                    {khoi('Thời gian (giây)', (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2.5">
                                <span className="text-sm font-semibold text-[#1a1a2e]">Bước Chỉnh ảnh</span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={chinhAnhBat}
                                    onClick={() => setConfigs((prev) => ({ ...prev, photo_edit_enabled: chinhAnhBat ? 'false' : 'true' }))}
                                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${chinhAnhBat ? 'bg-[#e63946]' : 'bg-gray-300'}`}
                                >
                                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${chinhAnhBat ? 'left-[22px]' : 'left-0.5'}`} />
                                </button>
                            </div>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                                {oGiay('session_capture_timeout', 'Chụp', '300')}
                                {oGiay('session_review_timeout', 'Chọn ảnh', '120')}
                                {chinhAnhBat && oGiay('photo_edit_timeout', 'Chỉnh ảnh', '200', 30)}
                                {oGiay('session_frame_timeout', 'Chọn khung & in', '180')}
                                {oGiay('id_studio_timeout', 'Studio ảnh thẻ', '300')}
                                {oGiay('countdown', 'Đếm ngược mỗi ảnh', '5', 1)}
                            </div>
                            <details className="group">
                                <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-bold text-gray-500 [&::-webkit-details-marker]:hidden">
                                    <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
                                    Nâng cao: chờ ảnh từ máy ảnh
                                </summary>
                                <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-md">
                                    {oGiay('canon_capture_timeout', 'Canon middleware', '30', 1)}
                                    {oGiay('hotfolder_capture_timeout', 'Hot Folder', '30', 1)}
                                </div>
                            </details>
                        </div>
                    ))}

                    {/* Điện thoại: nút Lưu nổi ngay trên thanh menu dưới (sticky không dính được vì <main> của
                        AdminLayout có overflow-x-hidden) -> luôn bấm được, không phải cuộn xuống cuối. */}
                    <div className="h-14 lg:hidden" />
                    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-40 px-4 lg:static lg:flex lg:justify-end lg:px-0">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className={`flex w-full items-center justify-center gap-2 rounded-xl px-8 py-3 font-bold text-white shadow-lg shadow-[#e63946]/20 transition-all duration-200 sm:w-auto ${saving ? 'cursor-not-allowed bg-gray-400' : 'bg-[#e63946] hover:bg-[#c1121f]'}`}
                        >
                            {saving
                                ? <><RefreshCw size={20} className="animate-spin" /> Đang lưu...</>
                                : <><Save size={20} /> Lưu thay đổi</>}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-8">
                    <DeviceManager />
                </div>
            )}
        </div>
    );
};

export default Settings;
