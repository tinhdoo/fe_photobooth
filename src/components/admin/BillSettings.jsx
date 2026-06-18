import { useEffect, useState } from 'react';
import axios from 'axios';
import { Banknote, Clock, Monitor, Power, RefreshCw, Save } from 'lucide-react';
import { io } from 'socket.io-client';
import { getDeviceId } from '../../utils/deviceId';
import { isLocalHost } from '../../utils/runtime';

const defaultHexCodes = ['40', '41', '42', '43', '44', '45', '46', '47'];

const BillSettings = () => {
    const [devices, setDevices] = useState([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState('');
    const [currentDeviceId, setCurrentDeviceId] = useState('');
    const [config, setConfig] = useState({ port: 'COM3', baudrate: 9600, enabled: false });
    const [mapping, setMapping] = useState({});
    const [ports, setPorts] = useState([]);
    const [status, setStatus] = useState({ state: 'disconnected', message: 'Chưa kết nối' });
    const [lastDebug, setLastDebug] = useState(null);
    const [cashHistory, setCashHistory] = useState({ total: 0, count: 0, entries: [], date: '' });
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState(null);

    const selectedIsLocal = selectedDeviceId && selectedDeviceId === currentDeviceId;
    const isLocalAdmin = isLocalHost();

    useEffect(() => {
        if (!isLocalAdmin) return undefined;

        const socket = io('/', {
            transports: ['polling'],
            auth: { deviceId: getDeviceId() }
        });

        socket.on('bill_status', (data) => {
            if (!data.device_id || data.device_id === selectedDeviceId) {
                setStatus({
                    state: data.status,
                    message: data.status === 'connected'
                        ? `Đã kết nối ${data.port || ''}`.trim()
                        : `Lỗi: ${data.message || 'Không xác định'}`
                });
            }
        });

        socket.on('bill_debug', (data) => {
            if (!data.device_id || data.device_id === selectedDeviceId) {
                setLastDebug(data.hex);
            }
        });

        socket.on('money_inserted', (data) => {
            if (!data.device_id || data.device_id === selectedDeviceId) {
                const entry = data.entry || {
                    id: `${Date.now()}-${data.amount}`,
                    amount: data.amount,
                    hex_code: data.hex,
                    created_at: new Date().toISOString()
                };
                setCashHistory((prev) => ({
                    ...prev,
                    total: Number(prev.total || 0) + Number(entry.amount || 0),
                    count: Number(prev.count || 0) + 1,
                    entries: [entry, ...(Array.isArray(prev.entries) ? prev.entries : [])].slice(0, 100)
                }));
            }
        });

        socket.on('config_updated_global', (data) => {
            if (data.device_id === selectedDeviceId) {
                fetchConfig(selectedDeviceId);
            }
        });

        return () => socket.disconnect();
    }, [selectedDeviceId, isLocalAdmin]);

    useEffect(() => {
        if (!isLocalAdmin) return;
        fetchDevices();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLocalAdmin]);

    useEffect(() => {
        if (!isLocalAdmin) return;
        if (selectedDeviceId) {
            fetchConfig(selectedDeviceId);
            fetchCashHistory(selectedDeviceId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDeviceId, isLocalAdmin]);

    const fetchDevices = async () => {
        setLoading(true);
        try {
            const [statusRes, devicesRes] = await Promise.all([
                axios.get('/api/bill/status'),
                axios.get('/api/devices')
            ]);

            const localId = statusRes.data?.device_id || getDeviceId();
            setCurrentDeviceId(localId);
            setSelectedDeviceId((prev) => prev || localId);
            setStatus({
                state: statusRes.data?.status || 'disconnected',
                message: statusRes.data?.status === 'connected'
                    ? `Đã kết nối ${statusRes.data?.port || ''}`.trim()
                    : statusRes.data?.enabled
                        ? 'Chưa kết nối'
                        : 'Đang tắt'
            });
            setDevices(Array.isArray(devicesRes.data) ? devicesRes.data : []);
            fetchPorts();
        } catch (error) {
            console.error('Failed to fetch bill devices', error);
            setMessage({ type: 'error', text: 'Không tải được danh sách thiết bị.' });
        } finally {
            setLoading(false);
        }
    };

    const fetchPorts = async () => {
        try {
            const res = await axios.get('/api/bill/ports');
            setPorts(Array.isArray(res.data) ? res.data : []);
        } catch (error) {
            console.warn('Failed to fetch serial ports', error);
            setPorts([]);
        }
    };

    const fetchCashHistory = async (deviceId = selectedDeviceId) => {
        if (!deviceId) return;
        try {
            const res = await axios.get('/api/bill/history', { params: { device_id: deviceId } });
            setCashHistory({
                total: Number(res.data?.total || 0),
                count: Number(res.data?.count || 0),
                entries: Array.isArray(res.data?.entries) ? res.data.entries : [],
                date: res.data?.date || ''
            });
        } catch (error) {
            console.warn('Failed to fetch bill cash history', error);
            setCashHistory({ total: 0, count: 0, entries: [], date: '' });
        }
    };

    const fetchConfig = async (deviceId) => {
        setLoading(true);
        try {
            const res = await axios.get(`/api/devices/${deviceId}/config`);
            const data = res.data;

            setConfig({
                port: data.bill_port || 'COM3',
                baudrate: parseInt(data.bill_baudrate, 10) || 9600,
                enabled: data.bill_enabled === 'true'
            });

            try {
                setMapping(data.bill_mapping ? JSON.parse(data.bill_mapping) : {});
            } catch {
                setMapping({});
            }
        } catch (error) {
            console.error('Failed to load bill config', error);
            setMessage({ type: 'error', text: 'Không tải được cấu hình đầu đọc tiền.' });
        } finally {
            setLoading(false);
        }
    };

    const handleConfigChange = (event) => {
        const { name, value, type, checked } = event.target;
        setConfig((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleMappingChange = (hex, value) => {
        setMapping((prev) => ({
            ...prev,
            [hex]: parseInt(value, 10) || 0
        }));
    };

    const saveConfig = async () => {
        if (!selectedDeviceId) return;

        try {
            await axios.post(`/api/devices/${selectedDeviceId}/config`, {
                bill_port: config.port,
                bill_baudrate: config.baudrate,
                bill_enabled: config.enabled,
                bill_mapping: JSON.stringify(mapping)
            });
            setMessage({ type: 'success', text: `Đã lưu cấu hình cho ${selectedDeviceId}.` });
            if (selectedIsLocal) {
                setStatus({
                    state: config.enabled ? 'restarting' : 'disabled',
                    message: config.enabled ? 'Đang khởi động lại đầu đọc...' : 'Đang tắt'
                });
            }
        } catch (error) {
            setMessage({ type: 'error', text: `Lỗi lưu cấu hình: ${error.message}` });
        }

        setTimeout(() => setMessage(null), 3000);
    };

    const formatVnd = (amount) => new Intl.NumberFormat('vi-VN').format(Number(amount || 0)) + ' d';

    const formatTime = (value) => {
        if (!value) return '--';
        return new Date(value).toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    if (!isLocalAdmin) {
        return (
            <div className="mx-auto max-w-2xl rounded-2xl border border-amber-100 bg-white p-8 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-700">
                    <Banknote size={28} />
                </div>
                <h2 className="text-2xl font-bold text-[#2f3e46]">Cấu hình đầu đọc tiền chỉ chạy trên máy booth</h2>
                <p className="mt-3 text-sm leading-6 text-[#52796f]">
                    Trang Vercel không kết nối trực tiếp được cổng COM hoặc đầu đọc tiền. Hãy mở admin bằng
                    <span className="font-semibold"> http://localhost:5173/admin/bill-settings </span>
                    trên máy photobooth đang cắm thiết bị.
                </p>
            </div>
        );
    }

    if (loading && !selectedDeviceId) {
        return <div className="p-8 text-center text-gray-500">Đang tải danh sách thiết bị...</div>;
    }

    const statusIsConnected = status.state === 'connected';

    return (
        <div className="mx-auto max-w-6xl space-y-6 animate-fadeIn">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-[#2f3e46] tracking-tight">Cài đặt đầu đọc tiền</h1>
                <p className="mt-1 text-sm md:text-base text-[#52796f]">Cấu hình cổng COM, baudrate và mệnh giá nhận tiền mặt.</p>
            </div>

            {message && (
                <div className={`rounded-lg p-4 ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {message.text}
                </div>
            )}

            <div className="flex flex-col items-start gap-6 xl:flex-row">
                <div className="w-full space-y-6 xl:w-1/3">
                    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="mb-4 flex items-center gap-3">
                            <Monitor className="text-[#52796f]" />
                            <h3 className="text-xl font-bold text-[#2f3e46]">Thiết bị</h3>
                        </div>

                        <label className="mb-2 block text-sm font-medium text-gray-700">Chọn thiết bị cấu hình</label>
                        <select
                            value={selectedDeviceId}
                            onChange={(event) => setSelectedDeviceId(event.target.value)}
                            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-[#d8b98e] focus:ring-[#d8b98e]"
                        >
                            {devices.map((device) => (
                                <option key={device.device_id} value={device.device_id}>
                                    {device.name} {device.device_id === currentDeviceId ? '(Máy này)' : ''}
                                </option>
                            ))}
                        </select>

                        {!selectedIsLocal && selectedDeviceId && (
                            <div className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-600">
                                Bạn đang cấu hình thiết bị khác. Trạng thái live chỉ chính xác khi máy đó đang mở.
                            </div>
                        )}
                    </div>

                    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="mb-6 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Power size={20} className={config.enabled ? 'text-green-600' : 'text-gray-400'} />
                                <h3 className="text-xl font-bold text-[#2f3e46]">Kết nối</h3>
                            </div>
                            <label className="relative inline-flex cursor-pointer items-center">
                                <input
                                    type="checkbox"
                                    name="enabled"
                                    checked={config.enabled}
                                    onChange={handleConfigChange}
                                    className="peer sr-only"
                                />
                                <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#d8b98e] peer-checked:after:translate-x-full peer-checked:after:border-white" />
                            </label>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-700">Cổng COM</label>
                                {ports.length > 0 ? (
                                    <select
                                        name="port"
                                        value={config.port}
                                        onChange={handleConfigChange}
                                        className="block w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-[#d8b98e] focus:ring-[#d8b98e]"
                                    >
                                        {ports.map((port) => (
                                            <option key={port.device} value={port.device}>
                                                {port.device} - {port.description}
                                            </option>
                                        ))}
                                        {!ports.some((port) => port.device === config.port) && (
                                            <option value={config.port}>{config.port}</option>
                                        )}
                                    </select>
                                ) : (
                                    <input
                                        type="text"
                                        name="port"
                                        value={config.port}
                                        onChange={handleConfigChange}
                                        placeholder="COM3"
                                        className="block w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-[#d8b98e] focus:ring-[#d8b98e]"
                                    />
                                )}
                                <button
                                    type="button"
                                    onClick={fetchPorts}
                                    className="mt-2 text-sm font-semibold text-[#52796f]"
                                >
                                    Quét lại cổng COM
                                </button>
                            </div>

                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-700">Baudrate</label>
                                <select
                                    name="baudrate"
                                    value={config.baudrate}
                                    onChange={handleConfigChange}
                                    className="block w-full rounded-xl border border-gray-200 px-4 py-2.5 shadow-sm focus:border-[#d8b98e] focus:ring-[#d8b98e]"
                                >
                                    <option value="9600">9600</option>
                                    <option value="19200">19200</option>
                                    <option value="115200">115200</option>
                                </select>
                            </div>

                            <div className="flex items-center justify-between border-t border-gray-50 pt-4">
                                <span className="text-sm text-gray-500">Trạng thái</span>
                                <div className="flex items-center gap-2">
                                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusIsConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                                    <span className={`text-sm font-bold ${statusIsConnected ? 'text-green-600' : 'text-red-500'}`}>
                                        {status.message}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="w-full space-y-6 xl:w-2/3">
                    <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
                        <div className="mb-6 flex items-center justify-between">
                            <h3 className="text-xl font-bold text-[#2f3e46]">Cấu hình mệnh giá</h3>
                            <button
                                type="button"
                                onClick={saveConfig}
                                className="inline-flex items-center rounded-xl bg-[#d8b98e] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#d8b98e]/20"
                            >
                                <Save size={18} className="mr-2" />
                                Lưu cấu hình
                            </button>
                        </div>

                        <p className="mb-6 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
                            Nhập giá trị tiền VND tương ứng với từng mã Hex đầu đọc gửi về. Đặt 0 để vô hiệu hóa mệnh giá đó.
                        </p>

                        <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
                            {defaultHexCodes.map((hex) => (
                                <div key={hex} className="space-y-2">
                                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">Mã 0x{hex}</label>
                                    <div className="relative rounded-lg shadow-sm">
                                        <input
                                            type="number"
                                            value={mapping[hex] || ''}
                                            onChange={(event) => handleMappingChange(hex, event.target.value)}
                                            className="block w-full rounded-xl border border-gray-200 py-3 pl-4 pr-12 font-mono text-lg font-medium focus:border-[#d8b98e] focus:ring-[#d8b98e]"
                                            placeholder="0"
                                        />
                                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                            <span className="text-xs font-bold text-gray-400">VND</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-gray-700 bg-[#2f3e46] p-6 text-white shadow-inner">
                        <div className="mb-4 flex items-center gap-3">
                            <div className="rounded-lg bg-white/10 p-2">
                                <RefreshCw size={20} className="text-green-400" />
                            </div>
                            <h4 className="text-lg font-bold">Live debugger</h4>
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-white/5 bg-black/20 p-6">
                            <span className="text-gray-400">Mã Hex nhận gần nhất</span>
                            <div className="font-mono text-3xl font-bold tracking-wider text-green-400">
                                {lastDebug ? `0x${lastDebug}` : '--'}
                            </div>
                        </div>
                        <p className="mt-4 flex items-center gap-2 text-xs text-gray-400">
                            <Banknote size={14} />
                            Đút thử tiền vào máy để xem mã Hex xuất hiện tại đây.
                        </p>
                    </div>

                    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h3 className="flex items-center gap-2 text-xl font-bold text-[#2f3e46]">
                                    <Clock size={20} className="text-[#52796f]" />
                                    Lịch sử tiền mặt hôm nay
                                </h3>
                                <p className="mt-1 text-sm text-gray-500">
                                    Tự động reset hiển thị khi sang ngày mới{cashHistory.date ? ` (${cashHistory.date})` : ''}.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => fetchCashHistory()}
                                className="inline-flex items-center justify-center rounded-xl border border-[#d8c0a0] px-4 py-2 text-sm font-bold text-[#7B5E43]"
                            >
                                <RefreshCw size={16} className="mr-2" />
                                Làm mới
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="rounded-2xl bg-[#F6F1E8] p-5">
                                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Tổng tiền</p>
                                <p className="mt-2 text-3xl font-extrabold text-[#52796f]">{formatVnd(cashHistory.total)}</p>
                            </div>
                            <div className="rounded-2xl bg-[#F6F1E8] p-5">
                                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Số lần nhận</p>
                                <p className="mt-2 text-3xl font-extrabold text-[#52796f]">{cashHistory.count}</p>
                            </div>
                        </div>

                        <div className="mt-5 max-h-72 overflow-y-auto rounded-2xl border border-gray-100">
                            {cashHistory.entries.length > 0 ? (
                                <table className="w-full text-left text-sm">
                                    <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wider text-gray-400">
                                        <tr>
                                            <th className="px-4 py-3">Thời gian</th>
                                            <th className="px-4 py-3">Mệnh giá</th>
                                            <th className="px-4 py-3">Hex</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {cashHistory.entries.map((entry) => (
                                            <tr key={entry.id}>
                                                <td className="px-4 py-3 font-medium text-gray-600">{formatTime(entry.created_at)}</td>
                                                <td className="px-4 py-3 font-bold text-[#2f3e46]">{formatVnd(entry.amount)}</td>
                                                <td className="px-4 py-3 font-mono text-gray-500">{entry.hex_code ? `0x${entry.hex_code}` : '--'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="p-8 text-center text-sm text-gray-400">
                                    Chưa có lần nhận tiền mặt nào trong ngày.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BillSettings;
