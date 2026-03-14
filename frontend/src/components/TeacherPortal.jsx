import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Upload, BookOpen, AlertTriangle } from 'lucide-react'

const TESTS_API = '/api/v1/tests/'
const SESSIONS_API = '/api/v1/sessions/'
const testQuestionsApi = (testId) => `/api/v1/tests/${encodeURIComponent(testId)}/questions`
const TEACHER_REGISTER_API = '/api/v1/auth/teachers/register'
const TEACHER_LOGIN_API = '/api/v1/auth/teachers/login'
const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`

const EVENT_UI = {
  VIOLATION_DETECTED: {
    label: 'Violation Detected',
    badgeClass: 'bg-red-100 text-red-700 border border-red-200',
  },
  EXAM_SUBMITTED: {
    label: 'Exam Submitted',
    badgeClass: 'bg-green-100 text-green-700 border border-green-200',
  },
  SESSION_STARTED: {
    label: 'Session Started',
    badgeClass: 'bg-blue-100 text-blue-700 border border-blue-200',
  },
  QUESTION_NAVIGATED: {
    label: 'Question Updated',
    badgeClass: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
  },
  IDLE_RESUMED: {
    label: 'Student Returned',
    badgeClass: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  },
}

const REASON_LABELS = {
  tab_switch_start: 'Student switched away from exam tab',
  tab_switch_duration: 'Student was away from exam tab for some time',
  window_focus_lost: 'Student switched away from exam window',
  window_focus_returned: 'Student returned to exam window after focus loss',
  fullscreen_exited: 'Student exited fullscreen mode',
  right_click: 'Right-click attempt detected',
  window_resized_below_threshold: 'Window size dropped below minimum threshold',
  blocked_keyboard_shortcut: 'Blocked keyboard shortcut attempt',
  idle_timeout: 'No activity detected for the idle threshold',
}

export default function TeacherPortal() {
  const navigate = useNavigate()
  const location = useLocation()
  const routeSection = location.pathname.split('/')[2] || 'dashboard'
  const activeSection = ['dashboard', 'results', 'violations', 'profile'].includes(routeSection)
    ? routeSection
    : 'dashboard'
  const [teacherUsername, setTeacherUsername] = useState('')
  const [teacherPassword, setTeacherPassword] = useState('')
  const [isRegisterMode, setIsRegisterMode] = useState(false)
  const [isTeacherAuthenticated, setIsTeacherAuthenticated] = useState(false)
  const [authMessage, setAuthMessage] = useState('')

  const [testId, setTestId] = useState('')
  const [title, setTitle] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(45)
  const [pdfFile, setPdfFile] = useState(null)
  const [usnPdfFile, setUsnPdfFile] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [previewFileSignature, setPreviewFileSignature] = useState('')
  const [questionPreviewLoading, setQuestionPreviewLoading] = useState(false)
  const [questionPreviewData, setQuestionPreviewData] = useState(null)
  const [questionPreviewError, setQuestionPreviewError] = useState('')
  const [tests, setTests] = useState([])
  const [uploadMessage, setUploadMessage] = useState('')
  const [createdTestPopup, setCreatedTestPopup] = useState(null)
  const [sessions, setSessions] = useState([])
  const [selectedTestForMonitoring, setSelectedTestForMonitoring] = useState('')
  const [selectedSession, setSelectedSession] = useState(null)
  const [selectedTestDetails, setSelectedTestDetails] = useState(null)
  const [testDetailsQuestions, setTestDetailsQuestions] = useState([])
  const [testDetailsLoading, setTestDetailsLoading] = useState(false)
  const [testDetailsError, setTestDetailsError] = useState('')
  const [testDetailsSearch, setTestDetailsSearch] = useState('')
  const [timelineBySession, setTimelineBySession] = useState({})
  const monitorSocketId = useMemo(() => `teacher-${Date.now()}`, [])
  const wsRef = useRef(null)

  useEffect(() => {
    const savedAuth = sessionStorage.getItem('teacherAuthenticated') === 'true'
    const savedUsername = sessionStorage.getItem('teacherUsername') || ''
    const savedPassword = sessionStorage.getItem('teacherPassword') || ''

    if (savedAuth && savedUsername && savedPassword) {
      setTeacherUsername(savedUsername)
      setTeacherPassword(savedPassword)
      setIsTeacherAuthenticated(true)
      setAuthMessage(`Logged in as ${savedUsername}`)
    }
  }, [])

  const loadTests = async () => {
    try {
      const response = await fetch(TESTS_API)
      if (!response.ok) return
      const data = await response.json()
      setTests(data)
    } catch {
      // ignore background errors
    }
  }

  useEffect(() => {
    loadTests()
  }, [])

  useEffect(() => {
    if (!selectedTestForMonitoring && tests.length > 0) {
      setSelectedTestForMonitoring(tests[0].test_id)
    }
  }, [selectedTestForMonitoring, tests])

  const loadSessions = async () => {
    try {
      const response = await fetch(SESSIONS_API)
      if (!response.ok) return
      const data = await response.json()
      const normalized = data.map((item) => ({
        id: item.id,
        studentName: item.student_name,
        studentId: item.student_identifier,
        testId: item.test_id || 'N/A',
        startedAt: item.started_at,
        status: item.status,
        trustScore: item.trust_score,
        violations: item.violations,
        correctAnswers: item.correct_answers,
        totalQuestions: item.total_questions,
        scorePercent: item.score_percent,
      }))
      setSessions(normalized)
    } catch {
      // ignore background errors
    }
  }

  const upsertTimelineEvent = (sessionId, event) => {
    setTimelineBySession((prev) => {
      const current = prev[sessionId] || []
      const exists = current.some((item) => item.id === event.id)
      if (exists) return prev
      const updated = [event, ...current].slice(0, 200)
      return { ...prev, [sessionId]: updated }
    })
  }

  useEffect(() => {
    if (!isTeacherAuthenticated) return

    loadSessions()

    const ws = new WebSocket(`${WS_BASE}/ws/admin/${monitorSocketId}`)
    wsRef.current = ws

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        const {
          session_id,
          event_id,
          event_type,
          trust_score,
          session_status,
          payload,
          event_timestamp,
        } = msg

        if (!session_id || !event_type) return

        upsertTimelineEvent(session_id, {
          id: event_id || `${session_id}-${event_type}-${Date.now()}`,
          eventType: event_type,
          payload: payload || {},
          timestamp: event_timestamp || new Date().toISOString(),
        })

        setSessions((prev) => {
          const existing = prev.find((s) => s.id === session_id)

          if (!existing) {
            return [
              {
                id: session_id,
                studentName: payload?.student_name || 'Unknown Student',
                studentId: payload?.student_identifier || 'N/A',
                testId: payload?.test_id || 'N/A',
                startedAt: new Date().toISOString(),
                status: session_status || 'active',
                trustScore: trust_score ?? 100,
                violations: event_type === 'VIOLATION_DETECTED' ? 1 : 0,
                correctAnswers: null,
                totalQuestions: null,
                scorePercent: null,
              },
              ...prev,
            ]
          }

          return prev.map((session) => {
            if (session.id !== session_id) return session
            const isViolation = event_type === 'VIOLATION_DETECTED'
            return {
              ...session,
              status: session_status || session.status,
              trustScore:
                trust_score !== null && trust_score !== undefined ? trust_score : session.trustScore,
              violations: isViolation ? session.violations + 1 : session.violations,
            }
          })
        })
      } catch {
        // ignore malformed ws payload
      }
    }

    ws.onerror = () => {
      // keep UI functional even without realtime channel
    }

    return () => ws.close()
  }, [isTeacherAuthenticated, monitorSocketId])

  useEffect(() => {
    if (!selectedSession) return

    const refreshed = sessions.find((s) => s.id === selectedSession.id)
    if (refreshed) {
      setSelectedSession(refreshed)
    }
  }, [selectedSession, sessions])

  useEffect(() => {
    if (!selectedSession) return

    fetch(`${SESSIONS_API}${selectedSession.id}/events`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed timeline fetch')
        return r.json()
      })
      .then((data) => {
        const timeline = data.map((item) => ({
          id: item.id,
          eventType: item.event_type,
          payload: item.payload || {},
          timestamp: item.timestamp,
        }))
        setTimelineBySession((prev) => ({ ...prev, [selectedSession.id]: timeline }))
      })
      .catch(() => {})
  }, [selectedSession])

  const getEventUi = (eventType) => {
    if (EVENT_UI[eventType]) return EVENT_UI[eventType]
    return {
      label: eventType.replaceAll('_', ' ').toLowerCase(),
      badgeClass: 'bg-slate-100 text-slate-700 border border-slate-200',
    }
  }

  const formatPayloadLabel = (key) => {
    const labels = {
      reason: 'Reason',
      away_seconds: 'Away Time',
      timestamp: 'Event Time',
      key: 'Key Pressed',
      ctrl: 'Ctrl Key',
      shift: 'Shift Key',
      alt: 'Alt Key',
      question_id: 'Question Number',
      selected: 'Selected Option',
      threshold: 'Threshold',
      area_ratio: 'Window Area Ratio',
      idle_seconds: 'Idle Time',
    }
    return labels[key] || key.replaceAll('_', ' ')
  }

  const formatPayloadValue = (key, value) => {
    if (value === null || value === undefined) return '-'
    if (key === 'reason') return REASON_LABELS[value] || String(value).replaceAll('_', ' ')
    if (key === 'timestamp' && typeof value === 'string') return new Date(value).toLocaleString()
    if (key === 'away_seconds' || key === 'idle_seconds') {
      const seconds = Number(value)
      return Number.isFinite(seconds) ? `${seconds.toFixed(2)} seconds` : String(value)
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  const getEventSummary = (event) => {
    if (event.eventType === 'VIOLATION_DETECTED') {
      const reason = event.payload?.reason
      return REASON_LABELS[reason] || 'Potentially suspicious activity detected during exam.'
    }
    if (event.eventType === 'EXAM_SUBMITTED') {
      return 'Student submitted the exam.'
    }
    if (event.eventType === 'SESSION_STARTED') {
      return 'Student entered the exam session.'
    }
    return 'Activity captured for this exam session.'
  }

  const monitoredSessions = sessions.filter((session) => {
    if (!selectedTestForMonitoring) return true
    return (session.testId || '').toUpperCase() === selectedTestForMonitoring.toUpperCase()
  })
  const resultSessions = [...monitoredSessions].sort((a, b) => {
    const aScore = Number(a.scorePercent)
    const bScore = Number(b.scorePercent)
    if (Number.isFinite(aScore) && Number.isFinite(bScore)) return bScore - aScore
    if (Number.isFinite(aScore)) return -1
    if (Number.isFinite(bScore)) return 1
    return 0
  })
  const violationSessions = [...monitoredSessions].sort((a, b) => b.violations - a.violations)
  const totalViolations = monitoredSessions.reduce((sum, item) => sum + item.violations, 0)
  const averageTrustScore =
    monitoredSessions.length > 0
      ? Math.round(
          monitoredSessions.reduce((sum, item) => sum + (Number(item.trustScore) || 0), 0) /
            monitoredSessions.length
        )
      : 0
  const scoredSessions = monitoredSessions.filter((item) => Number.isFinite(Number(item.scorePercent)))
  const averageScore =
    scoredSessions.length > 0
      ? Math.round(
          scoredSessions.reduce((sum, item) => sum + Number(item.scorePercent), 0) /
            scoredSessions.length
        )
      : null
  const selectedTimeline = selectedSession ? timelineBySession[selectedSession.id] || [] : []
  const testDetailSessions = selectedTestDetails
    ? sessions.filter(
        (session) =>
          (session.testId || '').toUpperCase() === (selectedTestDetails.test_id || '').toUpperCase()
      )
    : []
  const testDetailResults = [...testDetailSessions].sort((a, b) => {
    const aScore = Number(a.scorePercent)
    const bScore = Number(b.scorePercent)
    if (Number.isFinite(aScore) && Number.isFinite(bScore)) return bScore - aScore
    if (Number.isFinite(aScore)) return -1
    if (Number.isFinite(bScore)) return 1
    return 0
  })
  const testDetailViolations = [...testDetailSessions].sort((a, b) => b.violations - a.violations)
  const normalizedTestDetailsSearch = testDetailsSearch.trim().toLowerCase()
  const filteredTestDetailResults = testDetailResults.filter((session) => {
    if (!normalizedTestDetailsSearch) return true
    const studentName = (session.studentName || '').toLowerCase()
    const studentId = (session.studentId || '').toLowerCase()
    return (
      studentName.includes(normalizedTestDetailsSearch) ||
      studentId.includes(normalizedTestDetailsSearch)
    )
  })
  const filteredTestDetailViolations = testDetailViolations.filter((session) => {
    if (!normalizedTestDetailsSearch) return true
    const studentName = (session.studentName || '').toLowerCase()
    const studentId = (session.studentId || '').toLowerCase()
    return (
      studentName.includes(normalizedTestDetailsSearch) ||
      studentId.includes(normalizedTestDetailsSearch)
    )
  })
  const hasQuestionFile = !!pdfFile
  const hasUsnFile = !!usnPdfFile
  const usnPreviewReady =
    !!previewData &&
    previewData.accepted_count > 0 &&
    previewFileSignature === `${usnPdfFile?.name || ''}:${usnPdfFile?.size || ''}`
  const questionPreviewReady = !!questionPreviewData && questionPreviewData.total_detected_questions > 0

  const getScoreBandMeta = (score) => {
    const numeric = Number(score)
    if (!Number.isFinite(numeric)) {
      return {
        value: 'N/A',
        badgeClass: 'bg-slate-700/50 text-slate-200 border border-slate-600',
        textClass: 'text-slate-200',
      }
    }
    if (numeric >= 85) {
      return {
        value: `${numeric}%`,
        badgeClass: 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30',
        textClass: 'text-emerald-300',
      }
    }
    if (numeric >= 60) {
      return {
        value: `${numeric}%`,
        badgeClass: 'bg-amber-500/20 text-amber-200 border border-amber-500/30',
        textClass: 'text-amber-300',
      }
    }
    return {
      value: `${numeric}%`,
      badgeClass: 'bg-red-500/20 text-red-200 border border-red-500/30',
      textClass: 'text-red-300',
    }
  }

  const handleTeacherAuth = async (event) => {
    event.preventDefault()
    setAuthMessage('')

    const endpoint = isRegisterMode ? TEACHER_REGISTER_API : TEACHER_LOGIN_API
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: teacherUsername.trim(),
        password: teacherPassword,
      }),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      setAuthMessage(payload.detail || 'Teacher authentication failed')
      return
    }

    setIsTeacherAuthenticated(true)
    sessionStorage.setItem('teacherAuthenticated', 'true')
    sessionStorage.setItem('teacherUsername', teacherUsername.trim())
    sessionStorage.setItem('teacherPassword', teacherPassword)
    setAuthMessage(isRegisterMode ? 'Teacher account created.' : 'Teacher logged in.')
  }

  const handleTeacherLogout = () => {
    setIsTeacherAuthenticated(false)
    setAuthMessage('Logged out from teacher console.')
    setTeacherUsername('')
    setTeacherPassword('')
    setSelectedSession(null)
    setTimelineBySession({})
    setSessions([])
    sessionStorage.removeItem('teacherAuthenticated')
    sessionStorage.removeItem('teacherUsername')
    sessionStorage.removeItem('teacherPassword')
    navigate('/')
  }

  const handleOpenTestDetails = async (test) => {
    setSelectedTestDetails(test)
    setTestDetailsQuestions([])
    setTestDetailsError('')
    setTestDetailsLoading(true)

    try {
      const response = await fetch(testQuestionsApi(test.test_id))
      if (!response.ok) {
        throw new Error('Failed to load questions for this test')
      }
      const data = await response.json()
      setTestDetailsQuestions(Array.isArray(data) ? data : [])
    } catch (error) {
      setTestDetailsError(error.message || 'Failed to load test details')
    } finally {
      setTestDetailsLoading(false)
    }
  }

  const handleCloseTestDetails = () => {
    setSelectedTestDetails(null)
    setTestDetailsQuestions([])
    setTestDetailsError('')
    setTestDetailsLoading(false)
    setTestDetailsSearch('')
  }

  const handleUpload = async (event) => {
    event.preventDefault()
    setUploadMessage('')

    if (!pdfFile || !usnPdfFile) {
      setUploadMessage('Please choose both test PDF and USN-list PDF files.')
      return
    }

    const currentSignature = `${usnPdfFile.name}:${usnPdfFile.size}`
    if (!previewData || previewData.accepted_count === 0 || previewFileSignature !== currentSignature) {
      setUploadMessage('Preview and confirm valid USNs before final upload.')
      return
    }

    const formData = new FormData()
    formData.append('teacher_username', teacherUsername.trim())
    formData.append('teacher_password', teacherPassword)
    formData.append('test_id', testId.trim())
    formData.append('title', title.trim())
    formData.append('duration_minutes', String(durationMinutes))
    formData.append('pdf_file', pdfFile)
    formData.append('student_usn_pdf', usnPdfFile)

    const response = await fetch('/api/v1/tests/upload', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      setUploadMessage(payload.detail || 'Upload failed')
      return
    }

    const createdTest = await response.json().catch(() => ({}))

    setUploadMessage('Test uploaded successfully.')
    setCreatedTestPopup({
      title: createdTest?.title || title.trim() || 'Untitled Test',
      testId: createdTest?.test_id || testId.trim().toUpperCase() || 'N/A',
    })
    setTestId('')
    setTitle('')
    setDurationMinutes(45)
    setPdfFile(null)
    setUsnPdfFile(null)
    await loadTests()
  }

  const handlePreviewUsns = async () => {
    setUploadMessage('')
    if (!usnPdfFile) {
      setUploadMessage('Please upload a USN-list PDF first.')
      return
    }

    setPreviewLoading(true)

    try {
      const formData = new FormData()
      formData.append('teacher_username', teacherUsername.trim())
      formData.append('teacher_password', teacherPassword)
      formData.append('student_usn_pdf', usnPdfFile)

      const response = await fetch('/api/v1/tests/preview-usns', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.detail || 'USN preview failed')
      }

      const data = await response.json()
      setPreviewData(data)
      setPreviewFileSignature(`${usnPdfFile.name}:${usnPdfFile.size}`)
      setUploadMessage(`Preview complete: ${data.accepted_count} valid USNs found.`)
    } catch (error) {
      setPreviewData(null)
      setUploadMessage(error.message || 'USN preview failed')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handlePreviewQuestions = async () => {
    setUploadMessage('')
    setQuestionPreviewError('')
    if (!pdfFile) {
      setQuestionPreviewError('Please upload a question paper PDF first.')
      return
    }

    setQuestionPreviewLoading(true)
    try {
      const formData = new FormData()
      formData.append('teacher_username', teacherUsername.trim())
      formData.append('teacher_password', teacherPassword)
      formData.append('question_pdf', pdfFile)

      const response = await fetch('/api/v1/tests/preview-questions', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.detail || 'Question preview failed')
      }

      const data = await response.json()
      setQuestionPreviewData(data)
    } catch (error) {
      setQuestionPreviewData(null)
      setQuestionPreviewError(error.message || 'Question preview failed')
    } finally {
      setQuestionPreviewLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0B171E] text-slate-200 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {createdTestPopup && (
          <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center px-4">
            <div className="w-full max-w-md rounded-2xl border border-emerald-400/30 bg-[#13232C] shadow-2xl p-6">
              <h3 className="text-xl font-bold text-white mb-3">Test Created</h3>
              <div className="space-y-2 text-sm text-slate-200">
                <p>
                  Test Name:{' '}
                  <span className="font-semibold text-emerald-200">{createdTestPopup.title}</span>
                </p>
                <p>
                  Test ID:{' '}
                  <span className="font-semibold text-emerald-200">{createdTestPopup.testId}</span>
                </p>
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setCreatedTestPopup(null)}
                  className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold py-2 px-5 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {!isTeacherAuthenticated && (
          <div className="bg-[#13232C] border border-slate-700/50 rounded-2xl shadow-lg p-6 mb-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">Teacher Sign In</h2>
                {authMessage && <p className="text-sm text-slate-400">{authMessage}</p>}
              </div>
            </div>

            <>
              <form onSubmit={handleTeacherAuth} className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                <input
                  type="text"
                  value={teacherUsername}
                  onChange={(e) => setTeacherUsername(e.target.value)}
                  placeholder="teacher username"
                  required
                  className="w-full bg-slate-900/50 border border-white/10 text-white rounded-xl p-3 focus:ring-2 focus:ring-teal-500 focus:outline-none placeholder-slate-400"
                />
                <input
                  type="password"
                  value={teacherPassword}
                  onChange={(e) => setTeacherPassword(e.target.value)}
                  placeholder="password"
                  required
                  className="w-full bg-slate-900/50 border border-white/10 text-white rounded-xl p-3 focus:ring-2 focus:ring-teal-500 focus:outline-none placeholder-slate-400"
                />
                <button
                  type="submit"
                  className="bg-teal-500 hover:bg-teal-400 text-slate-900 font-bold py-2 px-6 rounded-lg transition-colors"
                >
                  {isRegisterMode ? 'Register Teacher' : 'Login Teacher'}
                </button>
              </form>

              <button
                type="button"
                onClick={() => setIsRegisterMode((v) => !v)}
                className="mt-3 text-xs text-slate-400 hover:text-slate-200"
              >
                {isRegisterMode ? 'Have account? Switch to login' : 'New teacher? Create account'}
              </button>
            </>
          </div>
        )}

        {isTeacherAuthenticated && (
          <div className="bg-[#10212A] border border-cyan-500/25 rounded-2xl shadow-lg p-4 mb-6">
            <nav className="grid grid-cols-2 lg:grid-cols-4 gap-2 w-full">
              {[
                ['dashboard', 'Dashboard'],
                ['results', 'Results'],
                ['violations', 'Violations'],
                ['profile', 'Profile'],
              ].map(([key, label]) => (
                <NavLink
                  key={key}
                  to={`/teacher/${key}`}
                  className={({ isActive }) =>
                    `w-full text-center px-5 py-3 rounded-xl text-sm font-semibold tracking-wide transition-all duration-200 ${
                      isActive
                        ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-900/40'
                        : 'border border-slate-700 bg-slate-900/40 text-slate-300 hover:text-white hover:border-cyan-500/40 hover:bg-slate-800/40'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        )}

        {isTeacherAuthenticated && activeSection === 'dashboard' && (
        <div className="bg-[#13232C] border border-slate-700/50 rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
            <div>
              <h2 className="text-white font-semibold text-2xl">Create and Publish New Test</h2>
              <p className="text-slate-400 text-sm mt-1">
                Follow the 4-step workflow below. All required checks are visible before publish.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`px-3 py-1.5 rounded-full font-semibold border ${hasQuestionFile ? 'bg-emerald-500/20 text-emerald-100 border-emerald-400/30' : 'bg-slate-900/50 text-slate-300 border-white/10'}`}>
                1. Question File {hasQuestionFile ? 'Ready' : 'Pending'}
              </span>
              <span className={`px-3 py-1.5 rounded-full font-semibold border ${hasUsnFile ? 'bg-emerald-500/20 text-emerald-100 border-emerald-400/30' : 'bg-slate-900/50 text-slate-300 border-white/10'}`}>
                2. USN File {hasUsnFile ? 'Ready' : 'Pending'}
              </span>
              <span className={`px-3 py-1.5 rounded-full font-semibold border ${usnPreviewReady ? 'bg-emerald-500/20 text-emerald-100 border-emerald-400/30' : 'bg-amber-500/20 text-amber-100 border-amber-300/30'}`}>
                3. USN Preview {usnPreviewReady ? 'Verified' : 'Required'}
              </span>
              <span className={`px-3 py-1.5 rounded-full font-semibold border ${questionPreviewReady ? 'bg-emerald-500/20 text-emerald-100 border-emerald-400/30' : 'bg-slate-900/50 text-slate-300 border-white/10'}`}>
                4. Question Preview {questionPreviewReady ? 'Verified' : 'Optional'}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 p-4 mb-5">
            <p className="text-white font-semibold text-sm mb-2">Operator Instructions</p>
            <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-400">
              <li>Enter test details and upload both files.</li>
              <li>Run USN preview and ensure valid student IDs are detected.</li>
              <li>Run question preview to confirm answer-key parsing.</li>
              <li>Click Publish Test to make exam active immediately.</li>
            </ol>
          </div>

          <form onSubmit={handleUpload} className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-end">
            <div>
              <label className="text-xs font-semibold text-white uppercase tracking-wide">Test ID</label>
              <input
                type="text"
                value={testId}
                onChange={(e) => setTestId(e.target.value)}
                placeholder="e.g. MC-APR-01"
                required
                disabled={!isTeacherAuthenticated}
                className="mt-1 w-full bg-[#0B171E] border border-slate-700 rounded-lg p-3 text-slate-200 placeholder-slate-400"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-white uppercase tracking-wide">Test Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Midterm Mock Test"
                required
                disabled={!isTeacherAuthenticated}
                className="mt-1 w-full bg-[#0B171E] border border-slate-700 rounded-lg p-3 text-slate-200 placeholder-slate-400"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-white uppercase tracking-wide">Duration (minutes)</label>
              <input
                type="number"
                min="1"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value || 1))}
                required
                disabled={!isTeacherAuthenticated}
                className="mt-1 w-full bg-[#0B171E] border border-slate-700 rounded-lg p-3 text-slate-200 placeholder-slate-400"
                placeholder="Duration (minutes)"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-white uppercase tracking-wide">Question Paper (PDF/TXT)</label>
              <input
                type="file"
                accept=".pdf,.txt,text/plain"
                onChange={(e) => {
                  setPdfFile(e.target.files?.[0] || null)
                  setQuestionPreviewData(null)
                  setQuestionPreviewError('')
                }}
                required
                disabled={!isTeacherAuthenticated}
                className="mt-1 w-full bg-[#0B171E] border border-slate-700 rounded-lg p-3 text-slate-200"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-white uppercase tracking-wide">Student Roster PDF</label>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => {
                  setUsnPdfFile(e.target.files?.[0] || null)
                  setPreviewData(null)
                  setPreviewFileSignature('')
                }}
                required
                disabled={!isTeacherAuthenticated}
                className="mt-1 w-full bg-[#0B171E] border border-slate-700 rounded-lg p-3 text-slate-200"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handlePreviewUsns}
                disabled={!isTeacherAuthenticated || !usnPdfFile || previewLoading}
                className="border border-slate-700 rounded-lg px-4 py-2 text-slate-200"
              >
                {previewLoading ? 'Previewing USNs...' : 'Preview USNs'}
              </button>
              <button
                type="button"
                onClick={handlePreviewQuestions}
                disabled={!isTeacherAuthenticated || !pdfFile || questionPreviewLoading}
                className="border border-slate-700 rounded-lg px-4 py-2 text-slate-200"
              >
                {questionPreviewLoading ? 'Parsing Questions...' : 'Preview Questions'}
              </button>
            </div>
            <div className="lg:col-span-2">
              <button
                type="submit"
                disabled={!isTeacherAuthenticated}
                className="bg-teal-500 hover:bg-teal-400 text-slate-900 font-bold py-2 px-6 rounded-lg transition-colors w-full flex items-center justify-center gap-2"
              >
                <Upload size={16} /> Publish Test
              </button>
            </div>
          </form>

          <div className="mt-4 rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-3">
            <p className="text-xs font-semibold text-cyan-100 mb-1">Question Format Demo (PDF or plain text)</p>
            <pre className="text-[11px] leading-5 text-cyan-100 whitespace-pre-wrap">
{`1. What is the capital of France?
A) Berlin
B) Madrid
C) Paris
D) Rome
Answer: C

2. Which keyword declares a function in Python?
A) func
B) function
C) def
D) lambda
Correct Answer: C`}
            </pre>
            <p className="text-[11px] text-cyan-100/85 mt-2">
              Tips: upload either a real PDF or a plain text file, start each question with a number (1., 2., 3.),
              each option with A), B), C), D), and include answer lines as Answer: X or Correct Answer: X.
            </p>
          </div>

          {previewData && (
            <div className="mt-4 rounded-xl border border-white/15 bg-slate-900/40 p-3">
              <p className="text-xs text-slate-300 mb-2">
                Parsed {previewData.accepted_count} valid USNs out of {previewData.total_candidates} detected tokens.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-teal-100 mb-1">Valid USNs</p>
                  <div className="max-h-36 overflow-y-auto rounded border border-white/10 bg-slate-950/60 p-2 text-xs text-slate-200">
                    {previewData.parsed_usns.length === 0 ? (
                      <p>No valid USNs found.</p>
                    ) : (
                      previewData.parsed_usns.map((usn) => <p key={usn}>{usn}</p>)
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-teal-100 mb-1">Rejected Tokens (sample)</p>
                  <div className="max-h-36 overflow-y-auto rounded border border-white/10 bg-slate-950/60 p-2 text-xs text-slate-200">
                    {previewData.rejected_tokens.length === 0 ? (
                      <p>No rejected tokens.</p>
                    ) : (
                      previewData.rejected_tokens.map((token) => <p key={token}>{token}</p>)
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {questionPreviewError && (
            <p className="mt-3 text-sm text-red-300">{questionPreviewError}</p>
          )}

          {questionPreviewData && (
            <div className="mt-4 rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-3">
              <p className="text-xs text-indigo-100 mb-2">
                Parsed {questionPreviewData.total_detected_questions} questions from {questionPreviewData.lines_scanned} lines.
              </p>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {questionPreviewData.parsed_questions.map((question) => (
                  <div key={question.question_number} className="rounded border border-indigo-300/40 bg-slate-950/50 p-2 text-xs text-slate-200">
                    <p className="font-semibold text-white">
                      {question.question_number}. {question.question_text}
                    </p>
                    <p>A) {question.option_a || '-'}</p>
                    <p>B) {question.option_b || '-'}</p>
                    <p>C) {question.option_c || '-'}</p>
                    <p>D) {question.option_d || '-'}</p>
                    <p className="mt-1 text-indigo-200 font-semibold">
                      Correct Answer: {question.correct_option || 'Not detected'}
                    </p>
                  </div>
                ))}
              </div>

              {questionPreviewData.ignored_lines_sample?.length > 0 && (
                <div className="mt-3 rounded border border-amber-300/40 bg-amber-500/10 p-2">
                  <p className="text-[11px] font-semibold text-amber-100 mb-1">Ignored Lines (sample)</p>
                  <div className="max-h-20 overflow-y-auto text-[11px] text-amber-100/90 space-y-1">
                    {questionPreviewData.ignored_lines_sample.map((line, idx) => (
                      <p key={`${idx}-${line}`}>{line}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="mt-3 rounded-xl border border-slate-700 bg-[#0F1D24] p-4">
            <p className="text-sm font-semibold text-white mb-2">Upload Guidelines</p>
            <ul className="list-decimal pl-5 space-y-1 text-sm text-slate-400">
              <li>Upload the actual question paper PDF for students.</li>
              <li>Upload the roster PDF containing student USNs.</li>
              <li>Question preview accepts the same PDF or a plain-text version of the questions.</li>
              <li>Test starts automatically at upload time; teachers only set duration.</li>
            </ul>
          </div>
          {uploadMessage && <p className="mt-3 text-sm text-slate-400">{uploadMessage}</p>}
        </div>
        )}

        {isTeacherAuthenticated && (activeSection === 'results' || activeSection === 'violations') && (
        <div className="bg-[#13232C] border border-slate-700/50 rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div className="flex items-center gap-2">
              <BookOpen size={18} className="text-cyan-300" />
              <h2 className="text-lg font-semibold text-white">
                {activeSection === 'results' ? 'Result Analytics' : 'Violation Monitoring'}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-400">Selected test</label>
              <select
                value={selectedTestForMonitoring}
                onChange={(e) => setSelectedTestForMonitoring(e.target.value)}
                disabled={!isTeacherAuthenticated || tests.length === 0}
                className="max-w-[220px] py-1.5 px-3 rounded-lg bg-[#0B171E] border border-slate-700 text-slate-200"
              >
                {tests.map((test) => (
                  <option key={test.id} value={test.test_id}>
                    {test.test_id} - {test.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {tests.length === 0 ? (
            <p className="text-sm text-slate-400">No tests uploaded yet.</p>
          ) : monitoredSessions.length === 0 ? (
            <>
              <div className="rounded-xl border border-slate-700 bg-[#0F1D24] p-4 mb-4">
                <p className="text-sm font-semibold text-white">
                  {tests.find((test) => test.test_id === selectedTestForMonitoring)?.title || 'Selected test'}
                </p>
                <p className="text-xs text-slate-400 mt-1">Test ID: {selectedTestForMonitoring || '-'}</p>
                <p className="text-xs text-slate-400">
                  Window:{' '}
                  {(() => {
                    const selectedTest = tests.find((test) => test.test_id === selectedTestForMonitoring)
                    const start = selectedTest?.start_time ? new Date(selectedTest.start_time).toLocaleString() : '-'
                    const end = selectedTest?.end_time ? new Date(selectedTest.end_time).toLocaleString() : '-'
                    return `${start} to ${end}`
                  })()}
                </p>
              </div>
              <p className="text-sm text-slate-400">No students have taken this test yet.</p>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-slate-700 bg-[#0F1D24] p-4 mb-4">
                <p className="text-sm font-semibold text-white">
                  {tests.find((test) => test.test_id === selectedTestForMonitoring)?.title || 'Selected test'}
                </p>
                <p className="text-xs text-slate-400 mt-1">Test ID: {selectedTestForMonitoring || '-'}</p>
                <p className="text-xs text-slate-400">
                  Window:{' '}
                  {(() => {
                    const selectedTest = tests.find((test) => test.test_id === selectedTestForMonitoring)
                    const start = selectedTest?.start_time ? new Date(selectedTest.start_time).toLocaleString() : '-'
                    const end = selectedTest?.end_time ? new Date(selectedTest.end_time).toLocaleString() : '-'
                    return `${start} to ${end}`
                  })()}
                </p>
                {tests.find((test) => test.test_id === selectedTestForMonitoring)?.pdf_url && (
                  <a
                    href={tests.find((test) => test.test_id === selectedTestForMonitoring)?.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-cyan-300 hover:text-cyan-200"
                  >
                    Open PDF
                  </a>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                <div className="rounded-xl border border-slate-700 bg-[#0F1D24] p-4">
                  <p className="text-sm text-slate-400">Sessions</p>
                  <p className="text-3xl font-bold text-white mt-1">{monitoredSessions.length}</p>
                </div>
                {activeSection === 'results' ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <p className="text-sm text-emerald-200">Average Score</p>
                    <p className="text-3xl font-bold text-emerald-300 mt-1">
                      {averageScore === null ? 'N/A' : `${averageScore}%`}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-700 bg-[#0F1D24] p-4">
                    <p className="text-sm text-slate-400">Active Sessions</p>
                    <p className="text-3xl font-bold text-white mt-1">
                      {monitoredSessions.filter((session) => session.status === 'active').length}
                    </p>
                  </div>
                )}
                <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4">
                  <p className="text-sm text-cyan-200">Average Trust</p>
                  <p className="text-3xl font-bold text-cyan-300 mt-1">{averageTrustScore}%</p>
                </div>
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                  <p className="text-sm text-red-200">Total Violations</p>
                  <p className="text-3xl font-bold text-red-300 mt-1">{totalViolations}</p>
                </div>
              </div>

              {activeSection === 'results' && (
              <div className="rounded-xl border border-emerald-500/30 bg-[#0F1D24] mb-5 overflow-hidden">
                <div className="px-4 py-4 border-b border-emerald-500/25 bg-emerald-500/10">
                  <h3 className="text-xl font-bold text-emerald-200">Student Results (Correct Answers Focus)</h3>
                  <p className="text-sm text-emerald-100/80 mt-1">
                    Ranking based on answer-key score from submitted responses.
                  </p>
                </div>

                <div className="sm:hidden space-y-3 p-3">
                  {resultSessions.map((session) => (
                    <div key={`result-card-${session.id}`} className="rounded-xl border border-slate-700 bg-[#13232C] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-bold text-white">{session.studentName}</p>
                          <p className="text-sm text-slate-400">{session.studentId}</p>
                        </div>
                        <span className={`chip text-sm ${getScoreBandMeta(session.scorePercent).badgeClass}`}>
                          {getScoreBandMeta(session.scorePercent).value}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <p className="text-slate-400">Correct</p>
                        <p className="font-semibold text-slate-200 text-right">
                          {session.correctAnswers ?? '-'} / {session.totalQuestions ?? '-'}
                        </p>
                        <p className="text-slate-400">Status</p>
                        <p className="font-semibold text-slate-200 text-right capitalize">{session.status}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-base">
                    <thead className="bg-emerald-500/10 text-sm text-emerald-200 uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-4 py-3">Student</th>
                        <th className="text-left px-4 py-3">USN</th>
                        <th className="text-left px-4 py-3">Correct</th>
                        <th className="text-left px-4 py-3">Score %</th>
                        <th className="text-left px-4 py-3">Status</th>
                        <th className="text-left px-4 py-3">Session Start</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/70">
                      {resultSessions.map((session) => (
                        <tr key={`result-${session.id}`} className="hover:bg-slate-800/40">
                          <td className="px-4 py-3 font-semibold text-slate-100">{session.studentName}</td>
                          <td className="px-4 py-3 text-slate-300">{session.studentId}</td>
                          <td className="px-4 py-3 text-slate-300 font-semibold">
                            {session.correctAnswers ?? '-'} / {session.totalQuestions ?? '-'}
                          </td>
                          <td className={`px-4 py-3 font-bold ${getScoreBandMeta(session.scorePercent).textClass}`}>
                            {getScoreBandMeta(session.scorePercent).value}
                          </td>
                          <td className="px-4 py-3 text-slate-300 capitalize">{session.status}</td>
                          <td className="px-4 py-3 text-slate-400">{new Date(session.startedAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              )}

              {activeSection === 'violations' && (
              <div className="rounded-xl border border-red-500/30 bg-[#0F1D24] overflow-hidden">
                <div className="px-4 py-4 border-b border-red-500/25 bg-red-500/10">
                  <h3 className="text-xl font-bold text-red-200">Violation Watchlist</h3>
                  <p className="text-sm text-red-100/80 mt-1">
                    Sorted by highest violations so proctoring attention stays on risky sessions.
                  </p>
                </div>

                <div className="sm:hidden space-y-3 p-3">
                  {violationSessions.map((session) => (
                    <div key={`violation-card-${session.id}`} className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-bold text-slate-100">{session.studentName}</p>
                          <p className="text-sm text-slate-400">{session.studentId}</p>
                        </div>
                        <span className="chip bg-red-500/20 text-red-200 border border-red-500/30 text-sm">{session.violations} violations</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedSession(session)}
                        className="mt-3 w-full bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-bold px-3 py-2 rounded-lg transition-colors"
                      >
                        View Violation Timeline
                      </button>
                    </div>
                  ))}
                </div>

                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-base">
                    <thead className="bg-red-500/10 text-sm text-red-200 uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-4 py-3">Student</th>
                        <th className="text-left px-4 py-3">USN</th>
                        <th className="text-left px-4 py-3">Started</th>
                        <th className="text-left px-4 py-3">Status</th>
                        <th className="text-left px-4 py-3">Violations</th>
                        <th className="text-left px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-red-500/20">
                      {violationSessions.map((session) => (
                        <tr key={`violation-${session.id}`} className="hover:bg-red-500/5">
                          <td className="px-4 py-3 font-semibold text-slate-100">{session.studentName}</td>
                          <td className="px-4 py-3 text-slate-300">{session.studentId}</td>
                          <td className="px-4 py-3 text-slate-400">{new Date(session.startedAt).toLocaleString()}</td>
                          <td className="px-4 py-3 text-slate-300 capitalize">{session.status}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 text-red-300 font-bold text-base">
                              <AlertTriangle size={15} /> {session.violations}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setSelectedSession(session)}
                              className="bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-bold px-3 py-1.5 rounded-lg transition-colors"
                            >
                              View Violations
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </>
          )}
        </div>
        )}

        {isTeacherAuthenticated && activeSection === 'profile' && (
          <div className="bg-[#13232C] border border-slate-700/50 rounded-2xl shadow-lg p-6 mb-6">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <h2 className="text-2xl font-bold text-white">Teacher Profile & Test Library</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTeacherLogout}
                  className="bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-bold py-2 px-6 rounded-lg transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-700 bg-[#0F1D24] p-4">
                <p className="text-sm text-slate-400">Username</p>
                <p className="text-xl font-semibold text-white mt-1">{teacherUsername || 'N/A'}</p>
              </div>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <p className="text-sm text-emerald-200">Account Status</p>
                <p className="text-xl font-semibold text-emerald-300 mt-1">Authenticated</p>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-slate-700 bg-[#0F1D24] overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700 bg-[#13232C]">
                <h3 className="text-lg font-semibold text-white">Previously Created Tests</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Access all past tests, schedules, and question PDFs from this library.
                </p>
              </div>

              {tests.length === 0 ? (
                <p className="px-4 py-5 text-sm text-slate-400">No tests available yet.</p>
              ) : (
                <>
                  <div className="sm:hidden p-3 space-y-3">
                    {tests.map((test) => (
                      <div
                        key={`profile-test-${test.id}`}
                        className="rounded-xl border border-slate-700 bg-[#13232C] p-3 cursor-pointer"
                        onClick={() => handleOpenTestDetails(test)}
                      >
                        <p className="text-base font-semibold text-slate-100">{test.title}</p>
                        <p className="text-sm text-slate-400">Test ID: {test.test_id}</p>
                        <p className="text-sm text-slate-400 mt-1">
                          Window: {test.start_time ? new Date(test.start_time).toLocaleString() : '-'} to{' '}
                          {test.end_time ? new Date(test.end_time).toLocaleString() : '-'}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="chip bg-slate-700/50 text-slate-200 border border-slate-600 text-xs">
                            {test.duration_minutes || '-'} min
                          </span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleOpenTestDetails(test)
                            }}
                            className="text-sm font-semibold text-cyan-300 hover:text-cyan-200"
                          >
                            View Details
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[#13232C] text-xs text-slate-300 uppercase tracking-wide">
                        <tr>
                          <th className="text-left px-4 py-3">Test ID</th>
                          <th className="text-left px-4 py-3">Title</th>
                          <th className="text-left px-4 py-3">Duration</th>
                          <th className="text-left px-4 py-3">Window</th>
                          <th className="text-left px-4 py-3">Created</th>
                          <th className="text-left px-4 py-3">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/70">
                        {tests.map((test) => (
                          <tr
                            key={`profile-test-row-${test.id}`}
                            className="hover:bg-slate-800/30 cursor-pointer"
                            onClick={() => handleOpenTestDetails(test)}
                          >
                            <td className="px-4 py-3 font-semibold text-slate-100">{test.test_id}</td>
                            <td className="px-4 py-3 text-slate-300">{test.title}</td>
                            <td className="px-4 py-3 text-slate-300">{test.duration_minutes || '-'} min</td>
                            <td className="px-4 py-3 text-slate-400">
                              {test.start_time ? new Date(test.start_time).toLocaleString() : '-'} to{' '}
                              {test.end_time ? new Date(test.end_time).toLocaleString() : '-'}
                            </td>
                            <td className="px-4 py-3 text-slate-400">
                              {test.created_at ? new Date(test.created_at).toLocaleString() : '-'}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleOpenTestDetails(test)
                                }}
                                className="text-sm font-semibold text-cyan-300 hover:text-cyan-200"
                              >
                                View Details
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {selectedTestDetails && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4"
          onClick={handleCloseTestDetails}
        >
          <div
            className="w-full max-w-6xl max-h-[92vh] overflow-hidden bg-[#13232C] rounded-2xl shadow-2xl border border-slate-700"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{selectedTestDetails.title}</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Test ID: {selectedTestDetails.test_id} · Duration: {selectedTestDetails.duration_minutes || '-'} min
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseTestDetails}
                className="border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(92vh-82px)] space-y-6">
              <section className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <label htmlFor="test-detail-search" className="text-sm font-semibold text-cyan-100">
                    Quick Search (Student Name or USN)
                  </label>
                  <span className="text-xs text-cyan-100/90">
                    Showing {filteredTestDetailResults.length} of {testDetailResults.length} results
                  </span>
                </div>
                <input
                  id="test-detail-search"
                  type="text"
                  value={testDetailsSearch}
                  onChange={(event) => setTestDetailsSearch(event.target.value)}
                  placeholder="Type student name or USN"
                  className="mt-3 w-full rounded-lg border border-cyan-500/40 bg-[#0B171E] px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </section>

              <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <h4 className="text-base font-semibold text-emerald-200 mb-3">Complete Results</h4>
                {filteredTestDetailResults.length === 0 ? (
                  <p className="text-sm text-slate-300">
                    {testDetailResults.length === 0
                      ? 'No student sessions found for this test.'
                      : 'No students match the current search filter.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-emerald-100 uppercase tracking-wide text-xs">
                        <tr>
                          <th className="px-3 py-2">Student</th>
                          <th className="px-3 py-2">USN</th>
                          <th className="px-3 py-2">Correct</th>
                          <th className="px-3 py-2">Score</th>
                          <th className="px-3 py-2">Trust</th>
                          <th className="px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-emerald-500/20">
                        {filteredTestDetailResults.map((session) => (
                          <tr key={`detail-result-${session.id}`}>
                            <td className="px-3 py-2 text-slate-100 font-semibold">{session.studentName}</td>
                            <td className="px-3 py-2 text-slate-300">{session.studentId}</td>
                            <td className="px-3 py-2 text-slate-300">
                              {session.correctAnswers ?? '-'} / {session.totalQuestions ?? '-'}
                            </td>
                            <td className="px-3 py-2 text-slate-200">{getScoreBandMeta(session.scorePercent).value}</td>
                            <td className="px-3 py-2 text-cyan-300">{session.trustScore}%</td>
                            <td className="px-3 py-2 text-slate-300 capitalize">{session.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                <h4 className="text-base font-semibold text-red-200 mb-3">Complete Violations</h4>
                {filteredTestDetailViolations.length === 0 ? (
                  <p className="text-sm text-slate-300">
                    {testDetailViolations.length === 0
                      ? 'No student sessions found for this test.'
                      : 'No students match the current search filter.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-red-100 uppercase tracking-wide text-xs">
                        <tr>
                          <th className="px-3 py-2">Student</th>
                          <th className="px-3 py-2">USN</th>
                          <th className="px-3 py-2">Violations</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Started</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-red-500/20">
                        {filteredTestDetailViolations.map((session) => (
                          <tr key={`detail-violation-${session.id}`}>
                            <td className="px-3 py-2 text-slate-100 font-semibold">{session.studentName}</td>
                            <td className="px-3 py-2 text-slate-300">{session.studentId}</td>
                            <td className="px-3 py-2 text-red-300 font-semibold">{session.violations}</td>
                            <td className="px-3 py-2 text-slate-300 capitalize">{session.status}</td>
                            <td className="px-3 py-2 text-slate-400">{new Date(session.startedAt).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-slate-700 bg-[#0F1D24] p-4">
                <h4 className="text-base font-semibold text-white mb-3">Questions</h4>
                {testDetailsLoading ? (
                  <p className="text-sm text-slate-400">Loading questions...</p>
                ) : testDetailsError ? (
                  <p className="text-sm text-red-300">{testDetailsError}</p>
                ) : testDetailsQuestions.length === 0 ? (
                  <p className="text-sm text-slate-400">No question details available for this test.</p>
                ) : (
                  <div className="space-y-3">
                    {testDetailsQuestions.map((question) => (
                      <div
                        key={`detail-question-${question.question_number}`}
                        className="rounded-lg border border-slate-700 bg-[#13232C] p-3"
                      >
                        <p className="text-sm font-semibold text-slate-100">
                          {question.question_number}. {question.question_text}
                        </p>
                        <div className="mt-2 text-sm text-slate-300 space-y-1">
                          <p>A) {question.option_a || '-'}</p>
                          <p>B) {question.option_b || '-'}</p>
                          <p>C) {question.option_c || '-'}</p>
                          <p>D) {question.option_d || '-'}</p>
                          <p className="text-emerald-300 font-semibold">
                            Correct Answer: {question.correct_option || 'Not detected'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {selectedSession && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4"
          onClick={() => setSelectedSession(null)}
        >
          <div
            className="w-full max-w-4xl max-h-[90vh] overflow-hidden bg-white rounded-xl shadow-2xl border border-slate-200"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">
                Session Details - {selectedSession.studentName}
              </h3>
              <button
                onClick={() => setSelectedSession(null)}
                className="text-sm font-medium text-slate-500 hover:text-slate-700"
              >
                Close
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(90vh-72px)]">
              <dl className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
                <div>
                  <dt className="text-slate-500">USN</dt>
                  <dd className="font-medium text-slate-800">{selectedSession.studentId}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Status</dt>
                  <dd className="font-medium text-slate-800">{selectedSession.status}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Test ID</dt>
                  <dd className="font-medium text-slate-800">{selectedSession.testId || 'N/A'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Trust Score</dt>
                  <dd className="font-medium text-slate-800">{selectedSession.trustScore}%</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Violations</dt>
                  <dd className="font-medium text-red-600">{selectedSession.violations}</dd>
                </div>
              </dl>

              <div className="mt-6 border-t border-slate-100 pt-5">
                <h4 className="text-sm font-semibold text-slate-800 mb-3">Violation Timeline</h4>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 mb-3">
                  <p className="text-xs text-slate-600">
                    Use this timeline to understand what happened in simple terms. Red badges indicate violations.
                  </p>
                </div>

                {selectedTimeline.length === 0 ? (
                  <p className="text-sm text-slate-500">No events logged for this session yet.</p>
                ) : (
                  <div className="max-h-80 overflow-y-auto space-y-3 pr-2">
                    {selectedTimeline.map((event) => (
                      <div key={event.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${getEventUi(event.eventType).badgeClass}`}
                          >
                            {getEventUi(event.eventType).label}
                          </span>
                          <p className="text-xs text-slate-500">
                            {new Date(event.timestamp).toLocaleString()}
                          </p>
                        </div>

                        <p className="text-xs text-slate-600 mb-2">{getEventSummary(event)}</p>

                        {Object.keys(event.payload || {}).length === 0 ? (
                          <p className="text-xs text-slate-500">No payload details.</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            {Object.entries(event.payload).map(([key, value]) => (
                              <div key={key} className="rounded bg-white px-2 py-1 border border-slate-200">
                                <span className="font-medium text-slate-600">{formatPayloadLabel(key)}: </span>
                                <span className="text-slate-800">{formatPayloadValue(key, value)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
