import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'

const API_BASE = ''
const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
const IDLE_TIMEOUT_MS = 60 * 1000
const MIN_WINDOW_RATIO = 0.8

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
  const parsedDuration = Number(sessionStorage.getItem('testDurationMinutes') || 45)
  const durationMinutes = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 45

  const [answers, setAnswers] = useState({})
  const [questions, setQuestions] = useState([])
  const [questionsLoading, setQuestionsLoading] = useState(true)
  const [timeLeft, setTimeLeft] = useState(durationMinutes * 60)
  const [toast, setToast] = useState(null)
  const [autoSubmitting, setAutoSubmitting] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [resultModal, setResultModal] = useState(null)

  const wsRef = useRef(null)
  const blurStartRef = useRef(null)
  const idleTimerRef = useRef(null)
  const isIdleRef = useRef(false)
  const isWindowSmallRef = useRef(false)
  // tracks whether fullscreen was ever entered so we only fire violations on exits, not on initial load
  const wasFullscreenRef = useRef(false)
  // suppresses fullscreen-exit violation when we intentionally exit (e.g., on submit)
  const intentionalFullscreenExitRef = useRef(false)
  // tracks window-level blur (Win+Tab, Alt+Tab, click-away) separately from tab visibility
  const windowBlurStartRef = useRef(null)

  useEffect(() => {
    if (!sessionId || !studentId || !testId) {
      navigate('/')
    }
  }, [navigate, sessionId, studentId, testId])

  // --- Load real test questions ---------------------------------------------
  useEffect(() => {
    if (!testId) return

    let cancelled = false

    const loadQuestions = async () => {
      setQuestionsLoading(true)
      try {
        const res = await fetch(`${API_BASE}/api/v1/tests/${encodeURIComponent(testId)}/questions`)
        if (!res.ok) throw new Error('Failed to fetch questions')
        const data = await res.json()
        if (cancelled) return

        const mapped = Array.isArray(data)
          ? data
              .map((q) => {
                const options = [q.option_a, q.option_b, q.option_c, q.option_d].filter(Boolean)
                return {
                  id: q.question_number,
                  text: q.question_text,
                  options,
                  correctOption: (q.correct_option || '').toUpperCase() || null,
                  optionMap: {
                    A: q.option_a || null,
                    B: q.option_b || null,
                    C: q.option_c || null,
                    D: q.option_d || null,
                  },
                }
              })
              .filter((q) => q.id && q.text)
          : []

        setQuestions(mapped)
      } catch {
        if (!cancelled) {
          setQuestions([])
        }
      } finally {
        if (!cancelled) {
          setQuestionsLoading(false)
        }
      }
    }

    loadQuestions()

    return () => {
      cancelled = true
    }
  }, [testId])

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

  /** Exit fullscreen if currently active */
  const exitFullscreen = useCallback(async () => {
    const isFull = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    )
    if (!isFull) return

    intentionalFullscreenExitRef.current = true
    const exit =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen

    if (!exit) {
      intentionalFullscreenExitRef.current = false
      return
    }

    try {
      await exit.call(document)
    } catch {
      // best-effort only; navigation continues even if browser blocks exit call
    } finally {
      setTimeout(() => {
        intentionalFullscreenExitRef.current = false
      }, 300)
    }
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

    const handleClipboardEvent = (e) => {
      e.preventDefault()
      emitEvent('VIOLATION_DETECTED', {
        reason: 'clipboard_event_blocked',
        event: e.type,
      })
      showToast('⚠️ Clipboard actions are blocked during the exam.')
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
      const modifier = e.ctrlKey || e.metaKey
      const isCopyLike = modifier && ['c', 'v', 'x', 'a'].includes(key)
      const isBrowserControl = modifier && ['s', 'p', 'u', 'r'].includes(key)
      const isDevtoolsCombo = modifier && e.shiftKey && ['i', 'j', 'c'].includes(key)
      const isF12 = e.key === 'F12'
      const isPrintScreen = e.key === 'PrintScreen'
      const shouldBlock =
        isCopyLike || isBrowserControl || isDevtoolsCombo || isF12 || isPrintScreen

      if (!shouldBlock) return

      e.preventDefault()
      e.stopPropagation()
      emitEvent('VIOLATION_DETECTED', {
        reason: 'blocked_keyboard_shortcut',
        key: e.key,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
      })

      if (isCopyLike) showToast('⚠️ Copy/paste and similar shortcuts are blocked during the exam.')
      if (isBrowserControl) showToast('⚠️ Browser shortcuts are blocked during the exam.')
      if (isDevtoolsCombo) showToast('⚠️ Developer tools shortcuts are blocked during the exam.')
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
        if (intentionalFullscreenExitRef.current) {
          wasFullscreenRef.current = isFull
          return
        }
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
    document.addEventListener('copy', handleClipboardEvent, true)
    document.addEventListener('cut', handleClipboardEvent, true)
    document.addEventListener('paste', handleClipboardEvent, true)
    window.addEventListener('keydown', handleBlockedKeys, true)
    document.addEventListener('keydown', handleBlockedKeys, true)
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
      document.removeEventListener('copy', handleClipboardEvent, true)
      document.removeEventListener('cut', handleClipboardEvent, true)
      document.removeEventListener('paste', handleClipboardEvent, true)
      window.removeEventListener('keydown', handleBlockedKeys, true)
      document.removeEventListener('keydown', handleBlockedKeys, true)
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

  const buildLocalScoreFallback = useCallback(() => {
    const gradableQuestions = questions.filter((q) => ['A', 'B', 'C', 'D'].includes(q.correctOption))
    const totalQuestions = gradableQuestions.length
    if (totalQuestions === 0) {
      return {
        correct_answers: null,
        total_questions: null,
        score_percent: null,
      }
    }

    let correctAnswers = 0
    gradableQuestions.forEach((q) => {
      const selected = answers[q.id]
      if (!selected) return

      const selectedUpper = String(selected).trim().toUpperCase()
      let normalized = null

      if (['A', 'B', 'C', 'D'].includes(selectedUpper)) {
        normalized = selectedUpper
      } else {
        const matched = Object.entries(q.optionMap || {}).find(([, optionText]) => {
          if (!optionText) return false
          return String(optionText).trim().toLowerCase() === String(selected).trim().toLowerCase()
        })
        if (matched) normalized = matched[0]
      }

      if (normalized && normalized === q.correctOption) {
        correctAnswers += 1
      }
    })

    return {
      correct_answers: correctAnswers,
      total_questions: totalQuestions,
      score_percent: Number(((correctAnswers / totalQuestions) * 100).toFixed(1)),
    }
  }, [answers, questions])

  const finishExamAndLeave = useCallback(async () => {
    setResultModal(null)
    sessionStorage.removeItem('sessionId')
    await exitFullscreen()
    navigate('/')
  }, [exitFullscreen, navigate])

  // --- Submit ----------------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    if (submitting) return

    setSubmitting(true)
    emitEvent('EXAM_SUBMITTED', { answers })

    let summaryData = null
    if (sessionId) {
      try {
        await fetch(`${API_BASE}/api/v1/sessions/${sessionId}/complete`, { method: 'POST' })
        const summaryRes = await fetch(`${API_BASE}/api/v1/sessions/${sessionId}/summary`)
        if (summaryRes.ok) {
          summaryData = await summaryRes.json()
        }
      } catch {
        // Session status will still be set through websocket submit event.
      }
    }

    const localFallback = buildLocalScoreFallback()
    setResultModal({
      scorePercent: summaryData?.score_percent ?? localFallback.score_percent,
      correctAnswers: summaryData?.correct_answers ?? localFallback.correct_answers,
      totalQuestions: summaryData?.total_questions ?? localFallback.total_questions,
      totalViolations: summaryData?.violations ?? 0,
      trustScore: summaryData?.trust_score ?? null,
      source: summaryData ? 'backend' : 'fallback',
    })
    setSubmitting(false)
  }, [answers, buildLocalScoreFallback, emitEvent, sessionId, submitting])

  useEffect(() => {
    if (timeLeft !== 0 || autoSubmitting) return

    setAutoSubmitting(true)
    showToast('Time is up. Auto-submitting your exam...')
    handleSubmit()
  }, [autoSubmitting, handleSubmit, timeLeft])

  return (
    <div className="app-shell py-0 px-0">
      {/* Fixed top nav */}
      <header className="fixed top-0 inset-x-0 z-30 bg-white/90 backdrop-blur border-b border-white/70 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="text-cyan-700" size={22} />
            <span className="font-bold text-slate-800 text-sm tracking-wide">SENTINEL</span>
            <span className="hidden lg:inline text-slate-300">|</span>
            <span className="hidden lg:inline text-sm font-medium text-slate-600 truncate max-w-[340px]">
              {testTitle}
            </span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            {/* Countdown */}
            <span
              className={`font-mono text-xs sm:text-sm font-semibold px-1.5 sm:px-2 py-0.5 sm:py-1 rounded ${
                timeLeft < 300 ? 'bg-red-100 text-red-700' : 'bg-cyan-100 text-cyan-800'
              }`}
            >
              ⏱ {formatTime(timeLeft)}
            </span>

            {/* Secure / fullscreen badge */}
            <span
              className={`text-[11px] sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full whitespace-nowrap ${
                isFullscreen
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700 animate-pulse'
              }`}
            >
              {isFullscreen ? '🔒 SECURE' : '⚠️ FULLSCREEN OFF'}
            </span>

            {/* Student name */}
            <span className="text-sm text-slate-600 hidden lg:block truncate max-w-[120px]">
              {studentName}
            </span>
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

      {resultModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center px-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6">
            <h3 className="text-xl font-bold text-slate-800 mb-3">Exam Submitted</h3>
            <div className="space-y-2 text-sm text-slate-700">
              <p>
                Final Score:{' '}
                <span className="font-semibold text-slate-900">
                  {resultModal.scorePercent == null ? 'N/A' : `${resultModal.scorePercent}%`}
                </span>
              </p>
              <p>
                Correct Answers:{' '}
                <span className="font-semibold text-slate-900">
                  {resultModal.correctAnswers == null || resultModal.totalQuestions == null
                    ? 'N/A'
                    : `${resultModal.correctAnswers}/${resultModal.totalQuestions}`}
                </span>
              </p>
              <p>
                Total Violations:{' '}
                <span className="font-semibold text-slate-900">{resultModal.totalViolations}</span>
              </p>
              {resultModal.trustScore != null && (
                <p>
                  Trust Score:{' '}
                  <span className="font-semibold text-slate-900">{resultModal.trustScore}</span>
                </p>
              )}
              {resultModal.source === 'fallback' && (
                <p className="text-xs text-amber-700">
                  Live scoring service was unavailable, showing client-calculated score.
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                onClick={finishExamAndLeave}
                className="primary-btn px-5 py-2"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exam body */}
      <main className="pt-20 pb-16">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="panel mb-4 py-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg sm:text-xl font-bold text-slate-800">{testTitle}</h2>
              <p className="text-xs sm:text-sm text-slate-600">
                Test ID: <span className="font-semibold text-slate-800">{testId}</span>
              </p>
            </div>
          </div>

          <div className="panel mb-4 py-4">
            <h3 className="text-base font-bold text-slate-800 mb-2">Exam Guidelines</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
              <li>Stay in fullscreen mode for the entire exam duration.</li>
              <li>Avoid switching tabs or windows while answering questions.</li>
              <li>Right-click, copy/paste, and developer shortcuts are blocked and logged.</li>
              <li>Submit only after reviewing all answers; unanswered questions may reduce score.</li>
              <li>Repeated violations reduce trust score and are reported in final results.</li>
            </ul>
          </div>

          <div className="space-y-5">
            {questionsLoading && (
              <div className="panel">
                <p className="text-sm text-slate-600">Loading questions...</p>
              </div>
            )}

            {!questionsLoading && questions.length === 0 && (
              <div className="panel">
                <p className="text-sm text-slate-600">
                  No questions found for this test. Please contact your teacher.
                </p>
              </div>
            )}

            {questions.map((q) => (
              <div
                key={q.id}
                className="panel"
              >
                <p className="font-medium text-slate-800 mb-4">
                  <span className="text-cyan-700 font-bold mr-2">Q{q.id}.</span>
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
              disabled={submitting || questionsLoading || questions.length === 0}
              className="primary-btn px-8 py-3"
            >
              {submitting ? 'SUBMITTING...' : 'SUBMIT EXAM'}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
