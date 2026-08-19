import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/common/ErrorBoundary.jsx'
import { Toaster } from 'react-hot-toast'
import axios from 'axios'
import { API_URL } from './config/api'
import { clearAuth } from './utils/auth'

axios.defaults.baseURL = API_URL

// Phiên admin hết hạn / bị từ chối (đổi AUTH_SECRET, tài khoản bị xóa...) -> backend trả 401.
// Thay vì để trang admin kẹt ở modal "Chưa đăng nhập hoặc phiên đã hết hạn", tự xóa phiên và
// đưa về trang đăng nhập. CHỈ áp dụng khi:
//  - request có kèm Authorization (là lời gọi admin đã đăng nhập), và
//  - đang ở khu vực /admin (không đụng tới trang khách: album, upload, kiosk).
axios.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status
    const hadAuth = !!(error?.config?.headers?.Authorization || error?.config?.headers?.authorization)
    const path = typeof window !== 'undefined' ? window.location.pathname : ''
    if (status === 401 && hadAuth && path.startsWith('/admin') && path !== '/admin/login') {
      clearAuth()
      window.location.replace('/admin/login')
    }
    return Promise.reject(error)
  }
)

// Đồng bộ device_id của BOOTH từ backend (ổn định, lưu file device_id.txt) thay cho
// id ngẫu nhiên trong localStorage -> tránh sinh "booth ảo" khi đổi trình duyệt/xóa cache.
// Chỉ chạy trên kiosk local; KHÔNG chạy trên trang khách (cloud).
if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
  axios.get('/api/config/system')
    .then((res) => {
      const backendId = res?.data?.device_id
      if (backendId && backendId !== localStorage.getItem('device_id')) {
        localStorage.setItem('device_id', backendId)
        localStorage.setItem('DEVICE_ID', backendId)
      }
    })
    .catch(() => {})
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: {
            borderRadius: '14px',
            background: '#FFFDF8',
            color: '#3F3127',
            border: '1px solid #F1DDBE',
            fontWeight: 700,
          },
          success: {
            iconTheme: {
              primary: '#7B5E43',
              secondary: '#FFFDF8',
            },
          },
          error: {
            iconTheme: {
              primary: '#E63946',
              secondary: '#FFFDF8',
            },
          },
        }}
      />
    </ErrorBoundary>
  </StrictMode>,
)
