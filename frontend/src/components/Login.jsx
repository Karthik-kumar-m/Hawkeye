import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'

/**
 * Student Login screen.
 * Stores student info in sessionStorage so ExamView can read it,
 * then navigates to /exam.
 */
export default function Login() {
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const navigate = useNavigate()

  const handleStart = (e) => {
    e.preventDefault()
    if (!name.trim() || !studentId.trim()) return
    // Persist to sessionStorage for use in ExamView
    sessionStorage.setItem('studentName', name.trim())
    sessionStorage.setItem('studentId', studentId.trim())
    navigate('/exam')
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-8">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <ShieldCheck className="text-blue-700 mb-3" size={48} strokeWidth={1.5} />
          <h1 className="text-xl font-bold text-slate-800 text-center tracking-wide">
            SENTINEL: Integrity-First Exam Platform
          </h1>
        </div>

        {/* Form */}
        <form onSubmit={handleStart} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Full Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jane Doe"
              required
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Student ID
            </label>
            <input
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="e.g. STU-2024-001"
              required
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2.5 rounded-md transition-colors"
          >
            START EXAM
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 mt-6">
          <Link to="/admin" className="hover:text-blue-600 transition-colors">
            Administrator Login
          </Link>
        </p>
      </div>
    </div>
  )
}
