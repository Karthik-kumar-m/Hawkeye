import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Link2, ChevronDown } from 'lucide-react'

const API_BASE = ''
const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
const IDLE_TIMEOUT_MS = 60 * 1000
const MIN_WINDOW_RATIO = 0.8

/** Sample exam questions */
const QUESTIONS = [
  {
    id: 1,
    text: 'What is the capital of France?',
    options: ['Berlin', 'Madrid', 'Paris', 'Rome'],
  },
  {
    id: 2,
    text: 'Which planet is known as the Red Planet?',
    options: ['Venus', 'Mars', 'Jupiter', 'Saturn'],
  },
  {
    id: 3,
    text: 'What is 12 × 12?',
    options: ['132', '144', '156', '124'],
  },
  {
    id: 4,
    text: 'Which element has the chemical symbol "O"?',
    options: ['Gold', 'Osmium', 'Oxygen', 'Oganesson'],
  },
  {
    id: 5,
    text: 'Who wrote "Romeo and Juliet"?',
    options: ['Charles Dickens', 'Jane Austen', 'William Shakespeare', 'Homer'],
  },
]

/** Format seconds as MM:SS */
function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0')
  const s = String(seconds % 60).padStart(2, '0')
  return `${m}:${s}`
}

/**
 * ExamView component – Student's exam interface.
 *
 * WebSocket lifecycle:
 *   - Connects to /ws/student/{studentId} on mount.
 *   - Emits QUESTION_NAVIGATED when a radio answer is selected.
 *   - Emits VIOLATION_DETECTED on tab-switch (visibilitychange) or right-click.
 *   - Disconnects cleanly on unmount.
 */
export default function ExamView() {
  const navigate = useNavigate()
  const studentName = sessionStorage.getItem('studentName') || 'Student'
  const studentId = sessionStorage.getItem('studentId') || ''
  const sessionId = sessionStorage.getItem('sessionId') || ''
  const testId = sessionStorage.getItem('testId') || ''
  const testTitle = sessionStorage.getItem('testTitle') || 'Assigned Test'
  const rawTestPdfUrl = sessionStorage.getItem('testPdfUrl') || ''
  const testPdfUrl = rawTestPdfUrl.startsWith('http') ? rawTestPdfUrl : `${window.location.origin}${rawTestPdfUrl}`
  const parsedDuration = Number(sessionStorage.getItem('testDurationMinutes') || 45)
  const durationMinutes = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 45

  const [answers, setAnswers] = useState({})
  const [timeLeft, setTimeLeft] = useState(durationMinutes * 60)
  const [toast, setToast] = useState(null)
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [resources, setResources] = useState([])
  const [autoSubmitting, setAutoSubmitting] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const wsRef = useRef(null)
  const blurStartRef = useRef(null)
  const idleTimerRef = useRef(null)
  const isIdleRef = useRef(false)
  const isWindowSmallRef = useRef(false)
  // tracks whether fullscreen was ever entered so we only fire violations on exits, not on initial load
  const wasFullscreenRef = useRef(false)
  // tracks window-level blur (Win+Tab, Alt+Tab, click-away) separately from tab visibility
  const windowBlurStartRef = useRef(null)

  // --- Fetch resources from REST API ----------------------------------------
  useEffect(() => {
    fetch(`${API_BASE}/api/v1/resources/`)
      .then((r) => r.json())
      .then((data) => setResources(data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!sessionId || !studentId || !testId) {
      navigate('/')
    }
  }, [navigate, sessionId, studentId, testId])

  // --- WebSocket setup -------------------------------------------------------
  useEffect(() => {
    if (!sessionId) return undefined

    const ws = new WebSocket(`${WS_BASE}/ws/student/${sessionId}`)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          event_type: 'SESSION_STARTED',
          payload: {
            student_name: studentName,
            student_identifier: studentId,
            test_id: testId,
          },
        })
      )
    }

    ws.onerror = () => console.warn('WS connection failed – backend may be offline')
    return () => ws.close()
  }, [sessionId, studentId, studentName, testId])

  /** Send a JSON event over the WebSocket if the socket is open */
  const emitEvent = useCallback((eventType, payload = {}) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event_type: eventType, payload }))
    }
  }, [])

  /** Ask the browser to enter fullscreen on the root element */
  const enterFullscreen = useCallback(() => {
    const el = document.documentElement
    const req =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.mozRequestFullScreen ||
      el.msRequestFullscreen
    if (req) req.call(el).catch(() => {})
  }, [])

  // --- Countdown timer -------------------------------------------------------
  useEffect(() => {
    const id = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(id)
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // --- Integrity listeners ---------------------------------------------------
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        blurStartRef.current = Date.now()
        emitEvent('VIOLATION_DETECTED', {
          reason: 'tab_switch_start',
          timestamp: new Date().toISOString(),
        })
        showToast('⚠️ Tab switch detected. Away-time timer started.')
      } else if (blurStartRef.current) {
        const awaySeconds = Number(((Date.now() - blurStartRef.current) / 1000).toFixed(2))
        blurStartRef.current = null
        emitEvent('VIOLATION_DETECTED', {
          reason: 'tab_switch_duration',
          away_seconds: awaySeconds,
          timestamp: new Date().toISOString(),
        })
        showToast(`⚠️ You were away from the exam tab for ${awaySeconds}s.`)
      }
    }

    const handleContextMenu = (e) => {
      e.preventDefault()
      emitEvent('VIOLATION_DETECTED', { reason: 'right_click' })
      showToast('⚠️ Right-click is disabled during the exam.')
    }

    const getWindowAreaRatio = () => {
      const widthRatio = window.innerWidth / Math.max(window.screen.availWidth || 1, 1)
      const heightRatio = window.innerHeight / Math.max(window.screen.availHeight || 1, 1)
      return widthRatio * heightRatio
    }

    const handleResize = () => {
      const ratio = Number(getWindowAreaRatio().toFixed(3))
      const tooSmall = ratio < MIN_WINDOW_RATIO

      if (tooSmall && !isWindowSmallRef.current) {
        isWindowSmallRef.current = true
        emitEvent('VIOLATION_DETECTED', {
          reason: 'window_resized_below_threshold',
          area_ratio: ratio,
          threshold: MIN_WINDOW_RATIO,
        })
        showToast('⚠️ Window size dropped below 80% of screen area.')
      }

      if (!tooSmall && isWindowSmallRef.current) {
        isWindowSmallRef.current = false
        emitEvent('WINDOW_RESIZE_NORMALIZED', {
          area_ratio: ratio,
          threshold: MIN_WINDOW_RATIO,
        })
      }
    }

    const handleBlockedKeys = (e) => {
      const key = e.key.toLowerCase()
      const isCtrlC = e.ctrlKey && key === 'c'
      const isCtrlV = e.ctrlKey && key === 'v'
      const isF12 = e.key === 'F12'
      const isPrintScreen = e.key === 'PrintScreen'
      const shouldBlock = isCtrlC || isCtrlV || isF12 || isPrintScreen

      if (!shouldBlock) return

      e.preventDefault()
      emitEvent('VIOLATION_DETECTED', {
        reason: 'blocked_keyboard_shortcut',
        key: e.key,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
      })

      if (isCtrlC) showToast('⚠️ Ctrl+C is blocked during the exam.')
      if (isCtrlV) showToast('⚠️ Ctrl+V is blocked during the exam.')
      if (isF12) showToast('⚠️ F12 is blocked during the exam.')
      if (isPrintScreen) showToast('⚠️ Print Screen attempt logged.')
    }

    const markIdle = () => {
      if (isIdleRef.current) return
      isIdleRef.current = true
      emitEvent('VIOLATION_DETECTED', {
        reason: 'idle_timeout',
        idle_seconds: IDLE_TIMEOUT_MS / 1000,
      })
      showToast('⚠️ No input detected for 60 seconds (idle flagged).')
    }

    const resetIdleTimer = () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }

      if (isIdleRef.current) {
        isIdleRef.current = false
        emitEvent('IDLE_RESUMED', { timestamp: new Date().toISOString() })
      }

      idleTimerRef.current = setTimeout(markIdle, IDLE_TIMEOUT_MS)
    }

    const activityEvents = ['mousemove', 'keydown', 'mousedown', 'touchstart']

    // --- Window / app focus loss (Win+Tab, Alt+Tab, click-away) -------------
    // Strategy: two layers so neither can be bypassed.
    //   Layer 1 – blur/focus events: fire instantly when available.
    //   Layer 2 – document.hasFocus() poll every 300 ms: catches Win+Tab
    //             Task-View mode and any case the event doesn't fire.
    // Both layers share windowBlurStartRef so they never double-count.

    const onFocusLost = () => {
      if (windowBlurStartRef.current) return // already tracking
      windowBlurStartRef.current = Date.now()
      emitEvent('VIOLATION_DETECTED', {
        reason: 'window_focus_lost',
        timestamp: new Date().toISOString(),
      })
      showToast('⚠️ Window focus lost — leaving the exam is a violation.')
    }

    const onFocusReturned = () => {
      if (!windowBlurStartRef.current) return
      const awaySeconds = Number(((Date.now() - windowBlurStartRef.current) / 1000).toFixed(2))
      windowBlurStartRef.current = null
      emitEvent('VIOLATION_DETECTED', {
        reason: 'window_focus_returned',
        away_seconds: awaySeconds,
        timestamp: new Date().toISOString(),
      })
    }

    // Layer 1 – instant event listeners
    const handleWindowBlur = () => onFocusLost()
    const handleWindowFocus = () => onFocusReturned()

    // Layer 2 – polling fallback (catches Win+Tab Task View and browser quirks)
    const focusPollInterval = setInterval(() => {
      if (!document.hasFocus()) {
        onFocusLost()
      } else {
        onFocusReturned()
      }
    }, 300)

    // --- Fullscreen enforcement -------------------------------------------
    const handleFullscreenChange = () => {
      const isFull = !!(  
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      )
      setIsFullscreen(isFull)
      if (!isFull && wasFullscreenRef.current) {
        emitEvent('VIOLATION_DETECTED', {
          reason: 'fullscreen_exited',
          timestamp: new Date().toISOString(),
        })
        setToast('⚠️ Exiting fullscreen is a violation. Return immediately.')
        setTimeout(() => setToast(null), 4000)
      }
      wasFullscreenRef.current = isFull
    }

    handleResize()
    resetIdleTimer()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    document.addEventListener('contextmenu', handleContextMenu)
    document.addEventListener('keydown', handleBlockedKeys)
    window.addEventListener('resize', handleResize)
    window.addEventListener('blur', handleWindowBlur)
    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('msfullscreenchange', handleFullscreenChange)
    activityEvents.forEach((eventName) => {
      document.addEventListener(eventName, resetIdleTimer)
    })

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      document.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('keydown', handleBlockedKeys)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('blur', handleWindowBlur)
      window.removeEventListener('focus', handleWindowFocus)
      clearInterval(focusPollInterval)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('msfullscreenchange', handleFullscreenChange)
      activityEvents.forEach((eventName) => {
        document.removeEventListener(eventName, resetIdleTimer)
      })
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }
    }
  }, [emitEvent])

  // --- Toast helper ----------------------------------------------------------
  const showToast = (message) => {
    setToast(message)
    setTimeout(() => setToast(null), 4000)
  }

  // --- Answer selection -------------------------------------------------------
  const handleAnswer = (questionId, option) => {
    setAnswers((prev) => ({ ...prev, [questionId]: option }))
    emitEvent('QUESTION_NAVIGATED', { question_id: questionId, selected: option })
  }

  // --- Submit ----------------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    emitEvent('EXAM_SUBMITTED', { answers })
    if (sessionId) {
      try {
        await fetch(`${API_BASE}/api/v1/sessions/${sessionId}/complete`, { method: 'POST' })
      } catch {
        // Session status will still be set through websocket submit event.
      }
    }
    sessionStorage.removeItem('sessionId')
    navigate('/')
  }, [answers, emitEvent, navigate, sessionId])

  useEffect(() => {
    if (timeLeft !== 0 || autoSubmitting) return

    setAutoSubmitting(true)
    showToast('Time is up. Auto-submitting your exam...')
    handleSubmit()
  }, [autoSubmitting, handleSubmit, timeLeft])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Fixed top nav */}
      <header className="fixed top-0 inset-x-0 z-30 bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-blue-700" size={22} />
            <span className="font-bold text-slate-800 text-sm tracking-wide">SENTINEL</span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-4">
            {/* Countdown */}
            <span
              className={`font-mono text-sm font-semibold px-2 py-1 rounded ${
                timeLeft < 300 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
              }`}
            >
              ⏱ {formatTime(timeLeft)}
            </span>

            {/* Resources dropdown */}
            <div className="relative">
              <button
                onClick={() => setResourcesOpen((o) => !o)}
                className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-700 transition-colors"
              >
                <Link2 size={15} />
                Resources
                <ChevronDown size={14} />
              </button>
              {resourcesOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-md shadow-lg z-40 py-1">
                  {resources.length === 0 ? (
                    <p className="text-xs text-slate-400 px-3 py-2">No resources available</p>
                  ) : (
                    resources.map((r) => (
                      <a
                        key={r.id}
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-3 py-2 text-sm text-slate-700 hover:bg-blue-50"
                      >
                        {r.title}
                      </a>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Secure / fullscreen badge */}
            <span
              className={`text-xs font-semibold px-2 py-1 rounded-full ${
                isFullscreen
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700 animate-pulse'
              }`}
            >
              {isFullscreen ? '🔒 SECURE' : '⚠️ FULLSCREEN OFF'}
            </span>

            {/* Student name */}
            <span className="text-sm text-slate-600 hidden sm:block">{studentName}</span>
          </div>
        </div>
      </header>

      {/* Fullscreen required overlay – blocks exam until student is in fullscreen */}
      {!isFullscreen && (
        <div className="fixed inset-0 z-50 bg-slate-900/95 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl p-10 max-w-md w-full mx-4 text-center">
            <div className="text-5xl mb-4">🔒</div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Fullscreen Required</h2>
            <p className="text-sm text-slate-500 mb-6">
              This exam must be taken in fullscreen mode. Exiting fullscreen at any point will
              be logged as a violation and reported to your teacher.
            </p>
            <button
              onClick={enterFullscreen}
              className="w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              {wasFullscreenRef.current ? 'Return to Fullscreen' : 'Enter Fullscreen to Begin'}
            </button>
          </div>
        </div>
      )}

      {/* Violation toast */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white text-sm font-medium px-5 py-3 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* Exam body */}
      <main className="pt-20 pb-16">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <h2 className="text-2xl font-bold text-slate-800 mb-6">
            {testTitle}
          </h2>

          <div className="bg-white shadow-sm rounded-lg p-6 border border-slate-100 mb-6">
            <p className="text-sm text-slate-600 mb-2">Test ID: <span className="font-semibold text-slate-800">{testId}</span></p>
            {testPdfUrl ? (
              <iframe
                src={testPdfUrl}
                title="Test PDF"
                className="w-full h-[420px] border border-slate-200 rounded-md"
              />
            ) : (
              <p className="text-sm text-slate-500">No PDF found for this test ID.</p>
            )}
          </div>

          <div className="space-y-5">
            {QUESTIONS.map((q) => (
              <div
                key={q.id}
                className="bg-white shadow-sm rounded-lg p-6 border border-slate-100"
              >
                <p className="font-medium text-slate-800 mb-4">
                  <span className="text-blue-700 font-bold mr-2">Q{q.id}.</span>
                  {q.text}
                </p>
                <div className="space-y-2">
                  {q.options.map((opt) => (
                    <label
                      key={opt}
                      className="flex items-center gap-3 cursor-pointer group"
                    >
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        value={opt}
                        checked={answers[q.id] === opt}
                        onChange={() => handleAnswer(q.id, opt)}
                        className="accent-blue-700"
                      />
                      <span className="text-sm text-slate-700 group-hover:text-blue-700 transition-colors">
                        {opt}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex justify-end">
            <button
              onClick={handleSubmit}
              className="bg-blue-700 hover:bg-blue-800 text-white font-semibold px-8 py-3 rounded-md transition-colors"
            >
              SUBMIT EXAM
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
