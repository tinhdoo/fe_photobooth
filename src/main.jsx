import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/common/ErrorBoundary.jsx'
import { Toaster } from 'react-hot-toast'

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
