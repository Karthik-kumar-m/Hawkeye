import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { Upload, BookOpen, AlertTriangle } from 'lucide-react'

const TESTS_API = '/api/v1/tests/'
const SESSIONS_API = '/api/v1/sessions/'
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
  right_click: 'Right-click attempt detected',
  window_resized_below_threshold: 'Window size dropped below minimum threshold',
  blocked_keyboard_shortcut: 'Blocked keyboard shortcut attempt',
  idle_timeout: 'No activity detected for the idle threshold',
}

export default function TeacherPortal() {
  const navigate = useNavigate()
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
  const [sessions, setSessions] = useState([])
  const [selectedTestForMonitoring, setSelectedTestForMonitoring] = useState('')
  const [selectedSession, setSelectedSession] = useState(null)
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
  const totalViolations = monitoredSessions.reduce((sum, item) => sum + item.violations, 0)
  const averageTrustScore =
    monitoredSessions.length > 0
      ? Math.round(
          monitoredSessions.reduce((sum, item) => sum + (Number(item.trustScore) || 0), 0) /
            monitoredSessions.length
        )
      : 0
  const selectedTimeline = selectedSession ? timelineBySession[selectedSession.id] || [] : []

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

    setUploadMessage('Test uploaded successfully.')
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
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
          <h1 className="text-2xl font-bold text-slate-800">Teacher Console</h1>
          <p className="text-sm text-slate-500 mt-1">
            Use one authenticated screen for test setup and live violation monitoring.
          </p>
          <p className="text-xs text-slate-400 mt-2">
            <Link to="/" className="text-blue-700 hover:text-blue-800">Back to Student Login</Link>
          </p>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Teacher Authentication</h2>
              {authMessage && <p className="text-sm text-slate-600">{authMessage}</p>}
            </div>
            {isTeacherAuthenticated && (
              <button
                type="button"
                onClick={handleTeacherLogout}
                className="text-xs font-semibold text-red-700 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-md"
              >
                Logout Teacher
              </button>
            )}
          </div>

          {!isTeacherAuthenticated && (
            <>
              <form onSubmit={handleTeacherAuth} className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                <input
                  type="text"
                  value={teacherUsername}
                  onChange={(e) => setTeacherUsername(e.target.value)}
                  placeholder="teacher username"
                  required
                  className="border border-slate-300 rounded-md px-3 py-2 text-sm"
                />
                <input
                  type="password"
                  value={teacherPassword}
                  onChange={(e) => setTeacherPassword(e.target.value)}
                  placeholder="password"
                  required
                  className="border border-slate-300 rounded-md px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="bg-slate-800 text-white rounded-md px-3 py-2 text-sm font-semibold hover:bg-slate-900"
                >
                  {isRegisterMode ? 'Register Teacher' : 'Login Teacher'}
                </button>
              </form>

              <button
                type="button"
                onClick={() => setIsRegisterMode((v) => !v)}
                className="mt-3 text-xs text-blue-700 hover:text-blue-800"
              >
                {isRegisterMode ? 'Have account? Switch to login' : 'New teacher? Create account'}
              </button>
            </>
          )}
        </div>

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Upload New Test</h2>
          <form onSubmit={handleUpload} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <input
              type="text"
              value={testId}
              onChange={(e) => setTestId(e.target.value)}
              placeholder="test id"
              required
              disabled={!isTeacherAuthenticated}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="test title"
              required
              disabled={!isTeacherAuthenticated}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
            <input
              type="number"
              min="1"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value || 1))}
              required
              disabled={!isTeacherAuthenticated}
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              placeholder="Duration (minutes)"
            />
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
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
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
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={!isTeacherAuthenticated}
              className="flex items-center justify-center gap-2 bg-blue-700 text-white rounded-md px-3 py-2 text-sm font-semibold hover:bg-blue-800 disabled:opacity-50"
            >
              <Upload size={14} /> Upload PDF Test
            </button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handlePreviewUsns}
              disabled={!isTeacherAuthenticated || !usnPdfFile || previewLoading}
              className="bg-slate-700 text-white rounded-md px-3 py-2 text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              {previewLoading ? 'Previewing...' : 'Preview Parsed USNs'}
            </button>
            <p className="text-xs text-slate-500">
              Run preview first to verify only valid college USNs are being accepted.
            </p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handlePreviewQuestions}
              disabled={!isTeacherAuthenticated || !pdfFile || questionPreviewLoading}
              className="bg-indigo-700 text-white rounded-md px-3 py-2 text-xs font-semibold hover:bg-indigo-800 disabled:opacity-50"
            >
              {questionPreviewLoading ? 'Parsing Questions...' : 'Preview Parsed Questions'}
            </button>
            <p className="text-xs text-slate-500">
              Use this to verify whether questions/options are detected correctly from a PDF or plain text question sheet.
            </p>
          </div>

          <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3">
            <p className="text-xs font-semibold text-blue-900 mb-1">Question Format Demo (PDF or plain text)</p>
            <pre className="text-[11px] leading-5 text-blue-900 whitespace-pre-wrap">
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
            <p className="text-[11px] text-blue-800 mt-2">
              Tips: upload either a real PDF or a plain text file, start each question with a number (1., 2., 3.),
              each option with A), B), C), D), and include answer lines as Answer: X or Correct Answer: X.
            </p>
          </div>

          {previewData && (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-600 mb-2">
                Parsed {previewData.accepted_count} valid USNs out of {previewData.total_candidates} detected tokens.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-slate-700 mb-1">Valid USNs</p>
                  <div className="max-h-36 overflow-y-auto rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                    {previewData.parsed_usns.length === 0 ? (
                      <p>No valid USNs found.</p>
                    ) : (
                      previewData.parsed_usns.map((usn) => <p key={usn}>{usn}</p>)
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-700 mb-1">Rejected Tokens (sample)</p>
                  <div className="max-h-36 overflow-y-auto rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
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
            <p className="mt-3 text-sm text-red-600">{questionPreviewError}</p>
          )}

          {questionPreviewData && (
            <div className="mt-4 rounded-md border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs text-indigo-900 mb-2">
                Parsed {questionPreviewData.total_detected_questions} questions from {questionPreviewData.lines_scanned} lines.
              </p>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {questionPreviewData.parsed_questions.map((question) => (
                  <div key={question.question_number} className="rounded border border-indigo-200 bg-white p-2 text-xs text-slate-700">
                    <p className="font-semibold text-slate-800">
                      {question.question_number}. {question.question_text}
                    </p>
                    <p>A) {question.option_a || '-'}</p>
                    <p>B) {question.option_b || '-'}</p>
                    <p>C) {question.option_c || '-'}</p>
                    <p>D) {question.option_d || '-'}</p>
                    <p className="mt-1 text-indigo-700 font-semibold">
                      Correct Answer: {question.correct_option || 'Not detected'}
                    </p>
                  </div>
                ))}
              </div>

              {questionPreviewData.ignored_lines_sample?.length > 0 && (
                <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2">
                  <p className="text-[11px] font-semibold text-amber-800 mb-1">Ignored Lines (sample)</p>
                  <div className="max-h-20 overflow-y-auto text-[11px] text-amber-800 space-y-1">
                    {questionPreviewData.ignored_lines_sample.map((line, idx) => (
                      <p key={`${idx}-${line}`}>{line}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Upload 1) the actual question paper PDF for students and 2) roster PDF containing student USNs.
            Question preview accepts the same PDF or a plain text version of the questions.
            Test starts automatically at upload time; teachers only set duration.
          </p>
          {uploadMessage && <p className="mt-3 text-sm text-slate-600">{uploadMessage}</p>}
        </div>

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div className="flex items-center gap-2">
              <BookOpen size={18} className="text-slate-700" />
              <h2 className="text-lg font-semibold text-slate-800">Test Sessions & Violations</h2>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-500">Selected test</label>
              <select
                value={selectedTestForMonitoring}
                onChange={(e) => setSelectedTestForMonitoring(e.target.value)}
                disabled={!isTeacherAuthenticated || tests.length === 0}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm disabled:opacity-50"
              >
                {tests.map((test) => (
                  <option key={test.id} value={test.test_id}>
                    {test.test_id} - {test.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!isTeacherAuthenticated ? (
            <p className="text-sm text-slate-500">Login as teacher to view live violations.</p>
          ) : tests.length === 0 ? (
            <p className="text-sm text-slate-500">No tests uploaded yet.</p>
          ) : monitoredSessions.length === 0 ? (
            <>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4 mb-4">
                <p className="text-sm font-semibold text-slate-800">
                  {tests.find((test) => test.test_id === selectedTestForMonitoring)?.title || 'Selected test'}
                </p>
                <p className="text-xs text-slate-600 mt-1">Test ID: {selectedTestForMonitoring || '-'}</p>
                <p className="text-xs text-slate-600">
                  Window:{' '}
                  {(() => {
                    const selectedTest = tests.find((test) => test.test_id === selectedTestForMonitoring)
                    const start = selectedTest?.start_time ? new Date(selectedTest.start_time).toLocaleString() : '-'
                    const end = selectedTest?.end_time ? new Date(selectedTest.end_time).toLocaleString() : '-'
                    return `${start} to ${end}`
                  })()}
                </p>
              </div>
              <p className="text-sm text-slate-500">No students have taken this test yet.</p>
            </>
          ) : (
            <>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4 mb-4">
                <p className="text-sm font-semibold text-slate-800">
                  {tests.find((test) => test.test_id === selectedTestForMonitoring)?.title || 'Selected test'}
                </p>
                <p className="text-xs text-slate-600 mt-1">Test ID: {selectedTestForMonitoring || '-'}</p>
                <p className="text-xs text-slate-600">
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
                    className="text-xs text-blue-700 hover:text-blue-800"
                  >
                    Open PDF
                  </a>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Sessions</p>
                  <p className="text-2xl font-semibold text-slate-800">{monitoredSessions.length}</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Active Sessions</p>
                  <p className="text-2xl font-semibold text-slate-800">
                    {monitoredSessions.filter((session) => session.status === 'active').length}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Total Violations</p>
                  <p className="text-2xl font-semibold text-red-600">{totalViolations}</p>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-white mb-4 overflow-x-auto">
                <div className="px-4 py-3 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-800">Student Results</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Summary for students who have taken this selected test.
                  </p>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-4 py-3">Student</th>
                      <th className="text-left px-4 py-3">USN</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3">Trust Score</th>
                      <th className="text-left px-4 py-3">Violations</th>
                      <th className="text-left px-4 py-3">Session Start</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {monitoredSessions.map((session) => (
                      <tr key={`result-${session.id}`} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{session.studentName}</td>
                        <td className="px-4 py-3 text-slate-600">{session.studentId}</td>
                        <td className="px-4 py-3 text-slate-600 capitalize">{session.status}</td>
                        <td className="px-4 py-3 text-slate-700 font-semibold">{session.trustScore}%</td>
                        <td className="px-4 py-3 text-red-700 font-semibold">{session.violations}</td>
                        <td className="px-4 py-3 text-slate-600">{new Date(session.startedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-xs text-slate-600">
                  Average trust score: <span className="font-semibold">{averageTrustScore}%</span>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-4 py-3">Students Taken Test</th>
                      <th className="text-left px-4 py-3">USN</th>
                      <th className="text-left px-4 py-3">Started</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3">Violations</th>
                      <th className="text-left px-4 py-3">Open Popup</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {monitoredSessions.map((session) => (
                      <tr key={session.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{session.studentName}</td>
                        <td className="px-4 py-3 text-slate-600">{session.studentId}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {new Date(session.startedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{session.status}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 text-red-700 font-semibold text-xs">
                            <AlertTriangle size={12} /> {session.violations}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedSession(session)}
                            className="text-xs font-semibold text-blue-700 border border-blue-200 hover:bg-blue-50 px-2 py-1 rounded-md"
                          >
                            View Violations
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
