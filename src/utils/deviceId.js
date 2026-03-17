import { v4 as uuidv4 } from 'uuid';

export function getDeviceId() {
    let id = localStorage.getItem("device_id");

    if (!id) {
        // Fallback for older kiosks
        id = localStorage.getItem("DEVICE_ID");
    }

    if (!id) {
        id = 'sf-device-' + uuidv4().slice(0, 10);
        localStorage.setItem("device_id", id);
        localStorage.setItem("DEVICE_ID", id); // for legacy code
    }

    return id;
}

export function getDeviceName() {
    return localStorage.getItem("device_name");
}

export function setDeviceName(name) {
    localStorage.setItem("device_name", name);
}
