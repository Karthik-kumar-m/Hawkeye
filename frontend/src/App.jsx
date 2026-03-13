import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Login from './components/Login'
import AdminLogin from './components/AdminLogin'
import ExamView from './components/ExamView'
import AuditorDashboard from './components/AuditorDashboard'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Student Login */}
        <Route path="/" element={<Login />} />
        {/* Admin / Auditor Login */}
        <Route path="/admin" element={<AdminLogin />} />
        {/* Student exam screen */}
        <Route path="/exam" element={<ExamView />} />
        {/* Auditor real-time dashboard */}
        <Route path="/dashboard" element={<AuditorDashboard />} />
      </Routes>
    </BrowserRouter>
  )
}
