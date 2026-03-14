import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react'

const API_BASE = ''
const TEACHER_REGISTER_API = '/api/v1/auth/teachers/register'
const TEACHER_LOGIN_API = '/api/v1/auth/teachers/login'

function fmtCountdown(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/**
 * Student Login screen.
 * Stores student info in sessionStorage so ExamView can read it,
 * then navigates to /exam.
 */
export default function Login() {
  const [mode, setMode] = useState('student') // student | teacher
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isRegisterMode, setIsRegisterMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [credentialError, setCredentialError] = useState('')
  const [scheduleWindowError, setScheduleWindowError] = useState('')
  const [generalStudentError, setGeneralStudentError] = useState('')
  const navigate = useNavigate()

  // Schedule lookup state
  const [schedule, setSchedule] = useState(null)
  const [scheduleStatus, setScheduleStatus] = useState('idle') // idle | loading | found | not_found
  const [countdown, setCountdown] = useState(null) // { phase: 'before'|'live'|'ended'|'unscheduled', seconds? }

  // Debounce test-id → fetch schedule
  useEffect(() => {
    if (mode !== 'student') {
      setSchedule(null)
      setScheduleStatus('idle')
      return
    }

    const testId = password.trim().toUpperCase()
    if (testId.length < 3) {
      setSchedule(null)
      setScheduleStatus('idle')
      return
    }

    const timer = setTimeout(async () => {
      setScheduleStatus('loading')
      try {
        const res = await fetch(`${API_BASE}/api/v1/tests/${encodeURIComponent(testId)}/schedule`)
        if (!res.ok) {
          setSchedule(null)
          setScheduleStatus('not_found')
          return
        }
        setSchedule(await res.json())
        setScheduleStatus('found')
      } catch {
        setSchedule(null)
        setScheduleStatus('not_found')
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [mode, password])

  // Live countdown ticker
  useEffect(() => {
    if (scheduleStatus !== 'found' || !schedule) {
      setCountdown(null)
      return
    }

    const tick = () => {
      const now = Date.now()
      const start = schedule.start_time ? new Date(schedule.start_time).getTime() : null
      const end = schedule.end_time ? new Date(schedule.end_time).getTime() : null

      if (!start && !end) {
        setCountdown({ phase: 'unscheduled' })
        return
      }
      if (start && now < start) {
        setCountdown({ phase: 'before', seconds: Math.ceil((start - now) / 1000) })
      } else if (end && now < end) {
        setCountdown({ phase: 'live', seconds: Math.ceil((end - now) / 1000) })
      } else {
        setCountdown({ phase: 'ended' })
      }
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [schedule, scheduleStatus])

  useEffect(() => {
    setAuthError('')
    setCredentialError('')
    setScheduleWindowError('')
    setGeneralStudentError('')
    setLoading(false)
    setSchedule(null)
    setScheduleStatus('idle')
    setCountdown(null)
    setUsername('')
    setPassword('')
    setIsRegisterMode(false)
  }, [mode])

  const handleStart = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) return

    setLoading(true)
    setAuthError('')
    setCredentialError('')
    setScheduleWindowError('')
    setGeneralStudentError('')

    try {
      if (mode === 'teacher') {
        const endpoint = isRegisterMode ? TEACHER_REGISTER_API : TEACHER_LOGIN_API
        const response = await fetch(`${API_BASE}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username.trim(),
            password,
          }),
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          throw new Error(payload.detail || 'Teacher authentication failed')
        }

        sessionStorage.setItem('teacherAuthenticated', 'true')
        sessionStorage.setItem('teacherUsername', username.trim())
        sessionStorage.setItem('teacherPassword', password)
        navigate('/teacher')
        return
      }

      const normalizedUsername = username.trim().toUpperCase()
      const normalizedTestId = password.trim().toUpperCase()

      const response = await fetch(`${API_BASE}/api/v1/sessions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_username: normalizedUsername,
          test_id: normalizedTestId,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        const detail = payload.detail || 'Student login failed'

        if (response.status === 401) {
          setCredentialError(detail)
          return
        }

        if (response.status === 403) {
          setScheduleWindowError(detail)
          return
        }

        if (response.status === 409) {
          setGeneralStudentError(detail)
          return
        }

        setGeneralStudentError(detail)
        return
      }

      const data = await response.json()
      sessionStorage.setItem('studentName', data.student_name)
      sessionStorage.setItem('studentId', data.student_identifier)
      sessionStorage.setItem('sessionId', data.session_id)
      sessionStorage.setItem('testId', data.test_id)
      sessionStorage.setItem('testTitle', data.test_title)
      sessionStorage.setItem('testPdfUrl', data.test_pdf_url)
      sessionStorage.setItem('testDurationMinutes', String(data.duration_minutes || 45))
      sessionStorage.setItem('testStartTime', data.test_start_time || '')
      sessionStorage.setItem('testEndTime', data.test_end_time || '')
      navigate('/exam')
    } catch (err) {
      if (mode === 'teacher') {
        setAuthError(err.message || 'Teacher authentication failed')
      } else {
        setGeneralStudentError(
          err.message || 'Could not connect to backend. Please ensure the server is running.'
        )
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#0a2e38] to-slate-950 p-6 flex items-center justify-center">
      <div className="max-w-7xl w-full grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="flex flex-col justify-center">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-sm font-semibold uppercase tracking-wider w-fit">
            <ShieldCheck size={16} /> Integrity-First Portal
          </span>
          <h1 className="text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-tight mt-6">
            Candidate Access, Live Integrity, Real-Time Control
          </h1>
          <p className="text-lg text-teal-100/70 mt-4">
            Start student exams with schedule-aware access or switch to teacher mode for exam operations.
            This experience is optimized for secure login, real-time status, and guided access.
          </p>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white/5 backdrop-blur-lg border border-white/10 rounded-3xl p-6 text-white">
              <p className="text-sm uppercase tracking-wider text-teal-300">Access Mode</p>
              <p className="text-2xl font-bold mt-2">{mode === 'student' ? 'Student' : 'Teacher'}</p>
              <p className="text-sm text-teal-100/70 mt-2">
                {mode === 'student'
                  ? 'Student login validates credentials and test window before entry.'
                  : 'Teacher login supports both sign-in and account registration.'}
              </p>
            </div>
            <div className="bg-white/5 backdrop-blur-lg border border-white/10 rounded-3xl p-6 text-white">
              <p className="text-sm uppercase tracking-wider text-teal-300">Live Schedule</p>
              <p className="text-2xl font-bold mt-2">
                {mode === 'student' && countdown ? countdown.phase.toUpperCase() : 'READY'}
              </p>
              <p className="text-sm text-teal-100/70 mt-2">
                Countdown and schedule status appear instantly after entering the test ID.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-[2rem] p-8 lg:p-12 shadow-2xl">
          <div className="mb-6 grid grid-cols-2 rounded-xl border border-white/10 bg-slate-900/40 p-1">
            <button
              type="button"
              onClick={() => setMode('student')}
              className={`rounded-lg px-3 py-3 text-sm font-semibold transition-colors ${
                mode === 'student' ? 'bg-teal-500 text-slate-900' : 'text-teal-100/80 hover:bg-white/5'
              }`}
            >
              Student Login
            </button>
            <button
              type="button"
              onClick={() => setMode('teacher')}
              className={`rounded-lg px-3 py-3 text-sm font-semibold transition-colors ${
                mode === 'teacher' ? 'bg-teal-500 text-slate-900' : 'text-teal-100/80 hover:bg-white/5'
              }`}
            >
              Teacher Login
            </button>
          </div>

          <form onSubmit={handleStart} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-teal-50 mb-2">
                {mode === 'student' ? 'Username (USN)' : 'Teacher Username'}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={mode === 'student' ? 'e.g. 4JN24CS065' : 'e.g. teacher01'}
                required
                className="w-full bg-slate-900/50 border border-white/10 text-white rounded-xl p-4 focus:ring-2 focus:ring-teal-500 focus:outline-none placeholder-slate-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-teal-50 mb-2">
                {mode === 'student' ? 'Password (Test ID)' : 'Password'}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  mode === 'student'
                    ? 'Enter test ID provided by teacher'
                    : 'Enter teacher password'
                }
                required
                className="w-full bg-slate-900/50 border border-white/10 text-white rounded-xl p-4 focus:ring-2 focus:ring-teal-500 focus:outline-none placeholder-slate-400"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-teal-500 hover:bg-teal-400 text-slate-900 font-bold text-lg py-4 rounded-xl transition-all duration-200 mt-6"
            >
              {loading
                ? 'AUTHENTICATING...'
                : mode === 'student'
                ? 'LOGIN & START'
                : isRegisterMode
                ? 'REGISTER TEACHER'
                : 'LOGIN TEACHER'}
            </button>

            {mode === 'teacher' && (
              <button
                type="button"
                onClick={() => setIsRegisterMode((value) => !value)}
                className="w-full text-sm text-teal-200 hover:text-teal-100"
              >
                {isRegisterMode ? 'Have account? Switch to login' : 'New teacher? Create account'}
              </button>
            )}

            {mode === 'teacher' && authError && <p className="text-sm text-red-300">{authError}</p>}

            {mode === 'student' && (credentialError || scheduleWindowError || generalStudentError) && (
              <div className="space-y-2">
                {credentialError && (
                  <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-red-300">Credential Error</p>
                    <p className="text-sm text-red-200 mt-0.5">{credentialError}</p>
                  </div>
                )}

                {scheduleWindowError && (
                  <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">Schedule Window</p>
                    <p className="text-sm text-amber-200 mt-0.5">{scheduleWindowError}</p>
                  </div>
                )}

                {generalStudentError && (
                  <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-red-300">Login Error</p>
                    <p className="text-sm text-red-200 mt-0.5">{generalStudentError}</p>
                  </div>
                )}
              </div>
            )}
          </form>

          {mode === 'student' && scheduleStatus !== 'idle' && (
            <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-4 text-sm animate-rise-in">
              {scheduleStatus === 'loading' && (
                <div className="flex items-center gap-2 text-teal-100/70">
                  <Loader2 size={14} className="animate-spin" />
                  Looking up test schedule...
                </div>
              )}

              {scheduleStatus === 'not_found' && (
                <div className="flex items-center gap-2 text-amber-300">
                  <XCircle size={14} />
                  Test ID not found or not yet published
                </div>
              )}

              {scheduleStatus === 'found' && schedule && countdown && (
                <>
                  <p className="font-semibold text-teal-50 mb-2 truncate">{schedule.title}</p>

                  {countdown.phase === 'unscheduled' && (
                    <div className="text-teal-100/70">No schedule set for this test</div>
                  )}

                  {countdown.phase === 'before' && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-amber-300 font-medium">
                        <Clock size={14} />
                        Test has not started yet - starts in
                      </div>
                      <div className="text-3xl font-mono font-bold text-amber-300 tracking-widest">
                        {fmtCountdown(countdown.seconds)}
                      </div>
                      <div className="text-xs text-teal-100/60">
                        Starts: {new Date(schedule.start_time).toLocaleString()} ·{' '}
                        Duration: {schedule.duration_minutes} min
                      </div>
                    </div>
                  )}

                  {countdown.phase === 'live' && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-emerald-300 font-medium">
                        <CheckCircle size={14} />
                        Test is live - window closes in
                      </div>
                      <div className="text-3xl font-mono font-bold text-emerald-300 tracking-widest">
                        {fmtCountdown(countdown.seconds)}
                      </div>
                      <div className="text-xs text-teal-100/60">
                        Duration: {schedule.duration_minutes} min · Ends:{' '}
                        {new Date(schedule.end_time).toLocaleString()}
                      </div>
                    </div>
                  )}

                  {countdown.phase === 'ended' && (
                    <div className="flex items-center gap-1.5 text-red-300">
                      <XCircle size={14} />
                      This test window has ended - login is no longer accepted
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
