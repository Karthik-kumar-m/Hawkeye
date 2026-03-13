import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'

const API_BASE = ''

/**
 * Student Login screen.
 * Stores student info in sessionStorage so ExamView can read it,
 * then navigates to /exam.
 */
export default function Login() {
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleStart = async (e) => {
    e.preventDefault()
    if (!name.trim() || !studentId.trim()) return

    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/api/v1/sessions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_name: name.trim(),
          student_identifier: studentId.trim(),
        }),
      })

      if (!response.ok) {
        throw new Error('Unable to start exam session')
      }

      const data = await response.json()
      sessionStorage.setItem('studentName', data.student_name)
      sessionStorage.setItem('studentId', data.student_identifier)
      sessionStorage.setItem('sessionId', data.session_id)
      navigate('/exam')
    } catch {
      setError('Could not connect to backend. Please ensure the server is running.')
    } finally {
      setLoading(false)
    }
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
            disabled={loading}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2.5 rounded-md transition-colors"
          >
            {loading ? 'STARTING...' : 'START EXAM'}
          </button>

          {error && <p className="text-xs text-red-600">{error}</p>}
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
