import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowDown, ArrowRight, Check, LockKeyhole, LoaderCircle, LogOut, Menu, Plus, ShieldCheck, X } from 'lucide-react'
import { supabase } from './lib/supabase'

type Photo = { file: File; preview: string; width: number; height: number }
type ModalKind = 'account' | 'upgrade' | null
type ReportResult = { overallScore: number; summary: string; sections: { title: string; score: number; note: string }[] }

function App() {
  const [photos, setPhotos] = useState<{ front: Photo | null; side: Photo | null }>({ front: null, side: null })
  const [report, setReport] = useState<ReportResult | null>(null)
  const [analysisMessage, setAnalysisMessage] = useState('')
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [modal, setModal] = useState<ModalKind>(null)
  const [accountMode, setAccountMode] = useState<'login' | 'signup'>('login')
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [awaitingEmailCode, setAwaitingEmailCode] = useState(false)
  const [accountMessage, setAccountMessage] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [billingMessage, setBillingMessage] = useState(false)
  const frontRef = useRef<HTMLInputElement>(null)
  const sideRef = useRef<HTMLInputElement>(null)
  const previewUrls = useRef(new Set<string>())

  useEffect(() => () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url)), [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (nextSession) setModal((current) => current === 'account' ? null : current)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const addPhoto = (kind: 'front' | 'side', file?: File) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setAnalysisMessage('Choose a JPEG, PNG, or WebP photo.')
      return
    }
    setReport(null)
    setAnalysisMessage('')
    const preview = URL.createObjectURL(file)
    previewUrls.current.add(preview)
    const image = new Image()
    image.onload = () => {
      setPhotos((current) => {
        const previous = current[kind]
        if (previous) {
          URL.revokeObjectURL(previous.preview)
          previewUrls.current.delete(previous.preview)
        }
        return { ...current, [kind]: { file, preview, width: image.naturalWidth, height: image.naturalHeight } }
      })
    }
    image.src = preview
  }

  const openAccount = (mode: 'login' | 'signup' = 'login', message = '') => {
    setAccountMode(mode)
    setAccountMessage(message)
    setAwaitingEmailCode(false)
    setEmailCode('')
    setModal('account')
  }

  const generateReport = async () => {
    setAnalysisMessage('')
    if (!photos.front || !photos.side) {
      setAnalysisMessage('Add both a front photo and a profile photo first.')
      return
    }
    if (!consentAccepted) {
      setAnalysisMessage('Confirm the age and photo-processing consent to continue.')
      return
    }
    if (!supabase) {
      setAnalysisMessage('Sign-in is not configured yet. Add your Supabase project URL and anon key.')
      return
    }

    const { data, error } = await supabase.auth.getSession()
    if (error) {
      setAnalysisMessage(error.message)
      return
    }
    if (!data.session) {
      openAccount('login', 'Sign in to run your report. Your photos stay in this browser until you submit them.')
      return
    }

    setReport(null)
    setAnalysisBusy(true)
    try {
      const formData = new FormData()
      formData.append('front', photos.front.file)
      formData.append('side', photos.side.file)
      formData.append('consent', 'true')
      formData.append('adult', 'true')
      const apiUrl = import.meta.env.VITE_API_URL || ''
      const response = await fetch(`${apiUrl}/api/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        body: formData,
      })
      const result = await response.json() as ReportResult | { error?: string }
      if (!response.ok) throw new Error('error' in result && result.error ? result.error : 'Analysis failed. Please try again.')
      setReport(result as ReportResult)
      window.setTimeout(() => document.getElementById('report')?.scrollIntoView({ behavior: 'smooth' }), 40)
    } catch (error) {
      setAnalysisMessage(error instanceof Error ? error.message : 'Analysis failed. Please try again.')
    } finally {
      setAnalysisBusy(false)
    }
  }

  const handleVerify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAccountMessage('')
    if (!supabase) {
      setAccountMessage('Supabase is not configured. Check your project URL and publishable key.')
      return
    }

    setAuthBusy(true)
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: emailCode.trim(),
        type: 'email',
      })
      if (error) throw error
      setAwaitingEmailCode(false)
      if (data.session) setModal(null)
      else {
        setAccountMode('login')
        setAccountMessage('Email verified. Log in to continue.')
      }
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : 'Could not verify the email code.')
    } finally {
      setAuthBusy(false)
    }
  }

  const submitAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAccountMessage('')
    if (!supabase) {
      setAccountMessage('Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to connect accounts.')
      return
    }

    setAuthBusy(true)
    try {
      if (accountMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        if (data.session) setModal(null)
        else {
          setAwaitingEmailCode(true)
          setAccountMessage(`Check your email for a confirmation code or link sent to ${email}.`)
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        setModal(null)
      }
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : 'Could not complete authentication.')
    } finally {
      setAuthBusy(false)
    }
  }

  const resendSignupCode = async () => {
    if (!supabase) return
    setAuthBusy(true)
    setAccountMessage('')
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email })
      if (error) throw error
      setAccountMessage(`Supabase accepted a resend request for ${email}. Check your inbox and spam folder; email delivery may be rate-limited.`)
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : 'Could not resend the verification code.')
    } finally {
      setAuthBusy(false)
    }
  }

  const handleAccountAction = async () => {
    if (session && supabase) {
      await supabase.auth.signOut()
      return
    }
    openAccount()
  }

  return (
    <main>
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="DoYouMog home">DoYouMog<span>.</span></a>
        <nav className="desktop-nav" aria-label="Main navigation">
          <a href="#upload">Analysis</a>
          <a href="#how-it-works">Method</a>
          <a href="#privacy">Privacy</a>
          <button className="nav-login" onClick={handleAccountAction}>{session ? <>{session.user.email} <LogOut size={14} /></> : <>Log in <ArrowRight size={14} /></>}</button>
        </nav>
        <button className="mobile-menu" aria-label={session ? 'Sign out' : 'Open account'} onClick={handleAccountAction}><Menu size={21} /></button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> DOYOUMOG / PORTRAIT TOOLS</div>
          <h1>Portrait<br />analysis</h1>
          <p className="hero-description">Compare two angles across three visual dimensions. Scores are subjective model estimates, not objective measures.</p>
          <div className="hero-actions">
            <a className="button button-dark" href="#upload">Add portrait photos <ArrowDown size={15} /></a>
            <span className="hero-note"><ShieldCheck size={15} /> Consent required</span>
          </div>
          <div className="hero-footnote">Images are sent for analysis only after you request a report.</div>
        </div>
        <div className="model-summary">
          <div className="summary-topline"><span>ANALYSIS CONFIGURATION</span><span>01 / INPUT</span></div>
          <h2>Two angles.<br />Three dimensions.</h2>
          <div className="summary-rows">
            <div><span className="summary-index">01</span><span>Frontal view</span><span className="summary-required">REQUIRED</span></div>
            <div><span className="summary-index">02</span><span>Profile view</span><span className="summary-required">REQUIRED</span></div>
          </div>
          <div className="summary-dimensions"><span>HARMONY</span><span>DEFINITION</span><span>PHOTO PRESENCE</span></div>
          <div className="summary-foot"><span className="status-indicator" /> AUTH + CONSENT REQUIRED</div>
        </div>
        <div className="hero-index">01 / 03 <span /> PHOTO INPUT</div>
      </section>

      <section className="upload-section" id="upload">
        <div className="section-heading">
          <div><div className="eyebrow"><span className="eyebrow-dot" /> 01 / PHOTO INPUT</div><h2>Add your photos</h2></div>
          <p className="section-aside">For a more complete read, share one front-facing photo and one profile. Photos are sent for AI processing only after you request a report.</p>
        </div>
        <div className="upload-grid">
          <PhotoSlot title="01 / FRONT" description="Face the camera, relaxed expression" photo={photos.front} inputRef={frontRef} onFile={(file) => addPhoto('front', file)} />
          <PhotoSlot title="02 / PROFILE" description="Turn to the side, eyes forward" photo={photos.side} inputRef={sideRef} onFile={(file) => addPhoto('side', file)} />
          <div className="upload-side-note"><span className="step-number">01—02</span><p>Even, natural light.<br />No filters. No rush.</p><button className="text-link" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}>Photo guide <ArrowRight size={14} /></button></div>
        </div>
        <div className="consent-wrap">
          <label className="consent-row"><input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} /><span>I am 18 or older and consent to sending these photos to OpenAI for analysis. Photos are not saved by this app.</span></label>
          <div className="upload-footer"><span className="privacy-note"><LockKeyhole size={14} /> Images are processed only when you request analysis</span><button className="button button-outline" onClick={generateReport} disabled={analysisBusy}>{analysisBusy ? <>Analyzing <LoaderCircle className="spin" size={15} /></> : <>See sample report <ArrowRight size={15} /></>}</button></div>
          {analysisMessage && <p className="integration-note analysis-message" role="status">{analysisMessage}</p>}
        </div>
      </section>

      <section className="method-section" id="how-it-works">
        <div className="method-top"><div className="eyebrow"><span className="eyebrow-dot" /> 02 / SCORING FRAMEWORK</div><span className="method-caption">MODEL OUTPUT / SUBJECTIVE</span></div>
        <div className="method-grid">
          <h2>Scoring<br />dimensions</h2>
          <article className="method-item"><span>01</span><h3>Three perspectives</h3><p>Harmony, feature definition, and photo presence are considered separately, not flattened into a single verdict.</p></article>
          <article className="method-item"><span>02</span><h3>Useful, not absolute</h3><p>Any score reflects a model's interpretation. It is not an objective measure of beauty, health, or personal value.</p></article>
          <article className="method-item"><span>03</span><h3>Your next steps</h3><p>Premium insights focus on controllable choices: lighting, expression, grooming, and camera angle.</p></article>
        </div>
      </section>

      {report && <section className="sample-section" id="report">
        <div className="sample-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> YOUR AI REPORT</div><h2>A useful read,<br /><em>not just a rating.</em></h2></div></div>
        <div className="report-preview">
          <div className="report-topline"><span>DOYOUMOG / PORTRAIT ANALYSIS</span><span>AI-GENERATED OPINION</span></div>
          <div className="report-main">
            <div className="report-score"><div className="score-ring"><span>{report.overallScore.toFixed(1)}</span><small>/ 10</small></div><span className="score-caption">OVERALL IMPRESSION</span><span className="score-sample">SUBJECTIVE MODEL ESTIMATE</span></div>
            <div className="report-details"><div className="report-title"><span>THE OVERVIEW</span><h3>Your portrait, in context.</h3><p>{report.summary}</p></div>
              <div className="score-list">{report.sections.map((item, index) => <div className="score-row" key={`${item.title}-${index}`}><span className="score-num">{String(index + 1).padStart(2, '0')}</span><div className="score-row-copy"><div className="score-row-title">{item.title}<span>{item.score.toFixed(1)}</span></div><p>{item.note}</p><div className="score-track"><i style={{ width: `${Math.max(0, Math.min(100, item.score * 10))}%` }} /></div></div></div>)}</div>
            </div>
            <div className="locked-report"><div className="locked-heading"><LockKeyhole size={17} /><span>THE FULL READ</span></div><h3>Specific insight.<br />Thoughtful next steps.</h3><p>Unlock the detailed breakdown, photo-by-photo notes, and a personal improvement plan.</p><button className="button button-dark" onClick={() => { setBillingMessage(false); setModal('upgrade') }}>Unlock full report <ArrowRight size={15} /></button><div className="locked-privacy"><ShieldCheck size={13} /> No recurring commitment</div></div>
          </div>
          <div className="report-disclaimer">AI-generated and subjective. This score is not an objective measure of attractiveness, health, or personal worth. Photos were sent to the configured AI provider for processing and are not saved by this app.</div>
        </div>
      </section>}

      <section className="privacy-section" id="privacy"><div className="privacy-mark"><ShieldCheck size={23} /></div><div><div className="eyebrow"><span className="eyebrow-dot" /> 03 / DATA HANDLING</div><h2>Image processing<br />and privacy</h2></div><p>Photos leave your device only when you request analysis and consent. They are processed in memory by this app and sent to OpenAI; review OpenAI's current privacy and retention terms.</p><button className="text-link" onClick={() => openAccount()}>Account access <ArrowRight size={14} /></button></section>

      <footer className="footer"><a className="wordmark" href="#top">DoYouMog<span>.</span></a><span>PORTRAIT ANALYSIS / VISION MODEL</span><span>© 2026 DOYOUMOG</span><a href="#privacy">Data handling</a></footer>

      {modal === 'account' && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="account-title">
            <button className="modal-close" onClick={() => setModal(null)} aria-label="Close"><X size={19} /></button>
            <div className="eyebrow"><span className="eyebrow-dot" /> DOYOUMOG ACCOUNT</div>
            <h2 id="account-title">
              {awaitingEmailCode ? <>Verify your<br /><em>email.</em></> : accountMode === 'signup' ? <>Start your<br /><em>account.</em></> : <>Good to have<br /><em>you here.</em></>}
            </h2>
            <form onSubmit={awaitingEmailCode ? handleVerify : submitAccount}>
              {awaitingEmailCode ? (
                <>
                  <p className="verification-instructions">Enter the verification code sent to <strong>{email}</strong>.</p>
                  <label htmlFor="email-code">Email verification code</label>
                  <input id="email-code" type="text" inputMode="numeric" autoComplete="one-time-code" required value={emailCode} onChange={(event) => setEmailCode(event.target.value)} placeholder="Enter the code from your email" />
                </>
              ) : (
                <>
                  <label htmlFor="email">Email address</label>
                  <input id="email" type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
                  <label htmlFor="password">Password</label>
                  <input id="password" type="password" autoComplete={accountMode === 'signup' ? 'new-password' : 'current-password'} required minLength={8} placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.target.value)} />
                </>
              )}
              <button className="button button-dark modal-submit" type="submit" disabled={authBusy}>
                {authBusy ? <>Please wait <LoaderCircle className="spin" size={15} /></> : <>{awaitingEmailCode ? 'Verify email' : accountMode === 'signup' ? 'Create account' : 'Log in'} <ArrowRight size={15} /></>}
              </button>
            </form>
            <div className="account-actions">
              {awaitingEmailCode && <button type="button" className="account-switch" onClick={resendSignupCode} disabled={authBusy}>{authBusy ? 'Sending request...' : 'Resend code'}</button>}
              <button type="button" className="account-switch" onClick={() => { setAccountMessage(''); setEmailCode(''); if (awaitingEmailCode) { setAwaitingEmailCode(false); setAccountMode('login') } else setAccountMode(accountMode === 'login' ? 'signup' : 'login') }}>
                {awaitingEmailCode ? 'Back to log in' : accountMode === 'login' ? 'New to DoYouMog? Create an account' : 'Already have an account? Log in'}
              </button>
            </div>
            {accountMessage && <p className="integration-note" role="status">{accountMessage}</p>}
            <p className="modal-footnote">{awaitingEmailCode ? <>You can also use the confirmation link. For numeric codes, set the Supabase Confirm signup email template to include <code>{'{{ .Token }}'}</code>.</> : accountMode === 'signup' ? 'You may need to confirm your email before logging in.' : 'Sign in to save and request your report.'}</p>
          </section>
        </div>
      )}

      {modal === 'upgrade' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}><section className="modal upgrade-modal" role="dialog" aria-modal="true" aria-labelledby="upgrade-title"><button className="modal-close" onClick={() => setModal(null)} aria-label="Close"><X size={19} /></button><div className="eyebrow"><span className="eyebrow-dot" /> YOUR FULL REPORT</div><h2 id="upgrade-title">The detail<br /><em>makes the difference.</em></h2><div className="upgrade-price"><span>$4.99</span><small>ONE-TIME PURCHASE · SAMPLE PRICE</small></div><ul className="upgrade-list"><li><Check size={15} /> Feature-by-feature breakdown</li><li><Check size={15} /> Front and profile photo notes</li><li><Check size={15} /> Personalized improvement tips</li></ul><button className="button button-dark modal-submit" onClick={() => setBillingMessage(true)}>Unlock full report <ArrowRight size={15} /></button>{billingMessage && <p className="integration-note" role="status">Payments are not connected yet. Add a checkout provider before accepting purchases.</p>}<p className="modal-footnote">One time. No subscription. Sample pricing only.</p></section></div>}
    </main>
  )
}

function PhotoSlot({ title, description, photo, inputRef, onFile }: { title: string; description: string; photo: Photo | null; inputRef: React.RefObject<HTMLInputElement | null>; onFile: (file?: File) => void }) {
  return <button className={`photo-slot ${photo ? 'has-photo' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onFile(event.dataTransfer.files[0]) }}>
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onClick={(event) => event.stopPropagation()} onChange={(event) => onFile(event.target.files?.[0])} />
    {photo ? <><img className="photo-preview" src={photo.preview} alt={`${title} photo preview`} /><span className="photo-replace"><Plus size={13} /> Replace</span><span className="photo-meta">{photo.width} × {photo.height}</span></> : <><span className="slot-plus"><Plus size={18} /></span><span className="slot-title">{title}</span><span className="slot-description">{description}</span><span className="slot-prompt">ADD A PHOTO <ArrowRight size={12} /></span></>}
  </button>
}

export default App