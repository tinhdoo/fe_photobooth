import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/common/ErrorBoundary.jsx'
import { Toaster } from 'react-hot-toast'
import axios from 'axios'
import { API_URL } from './config/api'

axios.defaults.baseURL = API_URL

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
