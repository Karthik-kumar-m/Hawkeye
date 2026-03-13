import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Login from './components/Login'
import ExamView from './components/ExamView'
import TeacherPortal from './components/TeacherPortal'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Student Login */}
        <Route path="/" element={<Login />} />
        {/* Student exam screen */}
        <Route path="/exam" element={<ExamView />} />
        {/* Teacher area with section navigation (dashboard/results/violations/profile) */}
        <Route path="/teacher/*" element={<TeacherPortal />} />
      </Routes>
    </BrowserRouter>
  )
}
