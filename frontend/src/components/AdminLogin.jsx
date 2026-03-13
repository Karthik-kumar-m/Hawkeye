import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'

/**
 * Admin / Auditor Login screen.
 * Stores admin credentials in sessionStorage, then navigates to /dashboard.
 */
export default function AdminLogin() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const navigate = useNavigate()

  const handleAccess = (e) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return
    sessionStorage.setItem('adminUsername', username.trim())
    // In a real app, authenticate against the backend here
    sessionStorage.setItem('adminId', `admin-${Date.now()}`)
    navigate('/dashboard')
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
          <p className="text-sm text-slate-500 mt-1">Auditor Access</p>
        </div>

        {/* Form */}
        <form onSubmit={handleAccess} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2.5 rounded-md transition-colors"
          >
            ACCESS DASHBOARD
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 mt-6">
          <Link to="/" className="hover:text-blue-600 transition-colors">
            ← Back to Student Login
          </Link>
        </p>
      </div>
    </div>
  )
}
