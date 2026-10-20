import { useEffect, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, CircleHelp, GraduationCap, LayoutDashboard, LockKeyhole, LogOut, Mail, Menu, Phone, ShieldCheck, Sparkles, Users, X } from 'lucide-react'
import './App.css'

const emptyForm = { name: '', mobile: '', email: '', college: '', year: '' }

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } })
  const data = response.status === 204 ? {} : await response.json()
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
  return data
}

function App() {
  const [page, setPage] = useState(() => window.location.pathname === '/admin' ? 'dashboard' : 'register')
  const [colleges, setColleges] = useState([])
  const [years, setYears] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(null)
  const [auth, setAuth] = useState({ checked: false, configured: false, signedIn: false })
  const [password, setPassword] = useState('')
  const [students, setStudents] = useState([])
  const [summary, setSummary] = useState({ total: 0, byCollege: [], byYear: [] })
  const [filterCollege, setFilterCollege] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    api('/api/colleges').then(({ colleges: collegeOptions, years: yearOptions }) => {
      setColleges(collegeOptions)
      setYears(yearOptions)
    }).catch(() => setNotice({ type: 'error', text: 'The registration service is unavailable. Please refresh in a moment.' }))

    if (window.location.pathname === '/admin') {
      api('/api/auth/status').then((status) => {
        setAuth((current) => ({ ...current, checked: true, configured: status.configured }))
      }).catch(() => setNotice({ type: 'error', text: 'Could not connect to the admin service.' }))
    }

    function handlePopState() {
      const isDashboard = window.location.pathname === '/admin'
      setPage(isDashboard ? 'dashboard' : 'register')
      setNotice(null)
      if (isDashboard) {
        api('/api/auth/status').then((status) => {
          setAuth((current) => ({ ...current, checked: true, configured: status.configured }))
        }).catch(() => setNotice({ type: 'error', text: 'Could not connect to the admin service.' }))
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  async function openDashboard() {
    if (window.location.pathname !== '/admin') window.history.pushState({}, '', '/admin')
    setPage('dashboard')
    setLoading(true)
    setNotice(null)
    try {
      const status = await api('/api/auth/status')
      setAuth((current) => ({ ...current, checked: true, configured: status.configured }))
    } catch {
      setNotice({ type: 'error', text: 'Could not connect to the admin service.' })
    }
    setLoading(false)
  }

  function openRegistration() {
    if (window.location.pathname !== '/') window.history.pushState({}, '', '/')
    setPage('register')
    setMenuOpen(false)
    setNotice(null)
  }

  useEffect(() => {
    if (!auth.signedIn || page !== 'dashboard') return
    let active = true
    const refreshStudents = () => {
      const query = new URLSearchParams()
      if (filterCollege) query.set('college', filterCollege)
      if (filterYear) query.set('year', filterYear)
      if (search.trim()) query.set('search', search.trim())
      api(`/api/students?${query}`).then((result) => {
        if (!active) return
        setStudents(result.students)
        setSummary({ total: result.total, byCollege: result.byCollege, byYear: result.byYear })
      }).catch((error) => {
        if (!active) return
        if (error.message === 'Admin sign-in required.') setAuth((current) => ({ ...current, signedIn: false }))
        else setNotice({ type: 'error', text: error.message })
      }).finally(() => {
        if (active) setLoading(false)
      })
    }
    refreshStudents()
    const refreshInterval = window.setInterval(refreshStudents, 5000)
    return () => {
      active = false
      window.clearInterval(refreshInterval)
    }
  }, [auth.signedIn, page, filterCollege, filterYear, search])

  async function submitRegistration(event) {
    event.preventDefault()
    setNotice(null)
    setSubmitting(true)
    try {
      const result = await api('/api/students', { method: 'POST', body: JSON.stringify(form) })
      setForm(emptyForm)
      setNotice({ type: 'success', text: result.message })
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally {
      setSubmitting(false)
    }
  }

  async function authenticate(event) {
    event.preventDefault()
    setNotice(null)
    setLoading(true)
    try {
      await api(auth.configured ? '/api/auth/login' : '/api/auth/setup', { method: 'POST', body: JSON.stringify({ password }) })
      setPassword('')
      setAuth((current) => ({ ...current, signedIn: true, configured: true }))
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    if (window.location.pathname !== '/') window.history.pushState({}, '', '/')
    setAuth((current) => ({ ...current, signedIn: false }))
    setPage('register')
  }

  async function updateStatus(student, field, status) {
    try {
      await api(`/api/students/${student.id}/status`, { method: 'PATCH', body: JSON.stringify({ field, status }) })
      setStudents((current) => current.map((item) => item.id === student.id ? { ...item, [field === 'mobile' ? 'mobileStatus' : 'emailStatus']: status } : item))
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    }
  }

  const visibleStudents = students

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); openRegistration() }} aria-label="Student Connect home">
          <span className="brand-mark"><GraduationCap size={22} strokeWidth={2.3} /></span>
          <span>student<span className="brand-light">connect</span></span>
        </a>
        <nav className={menuOpen ? 'topnav is-open' : 'topnav'} aria-label="Main navigation">
          <button className={page === 'register' ? 'nav-link active' : 'nav-link'} onClick={openRegistration}>For students</button>
          <a className={page === 'dashboard' ? 'nav-link active' : 'nav-link'} href="/admin" onClick={(event) => { event.preventDefault(); openDashboard(); setMenuOpen(false) }}><LayoutDashboard size={16} /> Admin dashboard</a>
          <a className="nav-help" href="mailto:hello@studentconnect.org"><CircleHelp size={16} /> Need help?</a>
        </nav>
        <a className="mobile-admin-link" href="/admin" onClick={(event) => { event.preventDefault(); openDashboard() }}><LayoutDashboard size={15} /> Admin</a>
        <button className="mobile-menu icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'}>{menuOpen ? <X /> : <Menu />}</button>
      </header>

      {page === 'register' ? (
        <main className="registration-page">
          <section className="intro-band">
            <div className="intro-copy">
              <div className="eyebrow"><span className="eyebrow-dot" /> YOUR NEXT CHAPTER STARTS HERE</div>
              <h1>Good things<br />happen <em>together.</em></h1>
              <p className="intro-lede">Student Connect brings campus ambassadors, curious minds, and big ideas into one community.</p>
              <div className="intro-foot"><span className="avatar-stack"><i>R</i><i>A</i><i>M</i><i>+</i></span><span>Made for students, by students</span><ArrowDown size={16} className="intro-arrow" /></div>
            </div>
            <div className="intro-photo" role="img" aria-label="Students celebrating together on campus">
              <div className="photo-label"><Sparkles size={15} /> FIND YOUR PEOPLE</div>
              <div className="photo-caption"><span>01 / 04</span><span>One community. Many possibilities.</span></div>
            </div>
            <div className="intro-index"><span>SC</span><span>2025 — 26</span></div>
          </section>

          <section className="form-section" id="registration">
            <div className="section-heading">
              <div><span className="section-kicker">THE FIRST STEP</span><h2>Let’s get to know you.</h2></div>
              <p>Join the network and hear about experiences, events, and opportunities made for your campus life.</p>
            </div>
            <div className="form-layout">
              <form className="registration-form" onSubmit={submitRegistration}>
                <div className="form-grid">
                  <label className="field full-field"><span>Your full name</span><input autoComplete="name" required minLength="2" maxLength="100" placeholder="e.g. Aanya Sharma" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
                  <label className="field"><span>Mobile number</span><div className="input-with-icon"><Phone size={17} /><input autoComplete="tel" type="tel" required minLength="8" maxLength="20" placeholder="+91 98765 43210" value={form.mobile} onChange={(event) => setForm({ ...form, mobile: event.target.value })} /></div></label>
                  <label className="field"><span>Email address</span><div className="input-with-icon"><Mail size={17} /><input autoComplete="email" type="email" required maxLength="254" placeholder="you@college.edu" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div></label>
                  <label className="field"><span>College or university</span><span className="select-wrap"><select required value={form.college} onChange={(event) => setForm({ ...form, college: event.target.value })}><option value="" disabled>Select your college</option>{colleges.map((college) => <option key={college}>{college}</option>)}</select><ChevronDown size={17} /></span></label>
                  <label className="field"><span>Current year of study</span><span className="select-wrap"><select required value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })}><option value="" disabled>Choose year</option>{years.map((year) => <option key={year}>{year}</option>)}</select><ChevronDown size={17} /></span></label>
                </div>
                {notice && <div className={`notice ${notice.type}`} role="status">{notice.type === 'success' ? <CheckCircle2 size={19} /> : <CircleHelp size={19} />}{notice.text}</div>}
                <div className="form-submit-row"><p><LockKeyhole size={14} /> Your details stay private and secure.</p><button className="primary-button" disabled={submitting}>{submitting ? 'Joining…' : 'Join the community'}<ArrowRight size={17} /></button></div>
                <div className="terms-note">By joining, you agree to receive relevant Student Connect updates. You can opt out any time.</div>
              </form>
              <aside className="why-panel">
                <div className="why-top"><span className="why-icon"><Users size={19} /></span><span>YOUR CAMPUS, CONNECTED</span></div>
                <h3>More than a<br />group chat.</h3>
                <p>Meet people who get it. Find ways to build, lead, and make your time on campus count.</p>
                <div className="why-list"><div><span>01</span><span>Campus events & meetups</span><ArrowUpRight size={15} /></div><div><span>02</span><span>Skills, stories & opportunities</span><ArrowUpRight size={15} /></div><div><span>03</span><span>A network that grows with you</span><ArrowUpRight size={15} /></div></div>
                <span className="why-scribble">SC.</span>
              </aside>
            </div>
          </section>
          <footer className="site-footer"><span>© 2025 Student Connect</span><span>Built around student life <span className="footer-star">✳</span></span><a href="mailto:hello@studentconnect.org">Get in touch <ArrowUpRight size={13} /></a></footer>
        </main>
      ) : (
        <main className="dashboard-page">
          {!auth.signedIn ? (
            <section className="auth-screen">
              <div className="auth-decoration"><div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" /><GraduationCap size={47} /></div>
              <span className="section-kicker">STUDENT CONNECT / ADMIN</span>
              <h1>{auth.checked && !auth.configured ? 'Set up your dashboard.' : 'Welcome back.'}</h1>
              <p>{auth.checked && !auth.configured ? 'Create the admin password for this installation. Use at least 12 characters.' : 'Sign in to manage student registrations and verification.'}</p>
              <form className="auth-form" onSubmit={authenticate}>
                <label className="field"><span>{auth.checked && !auth.configured ? 'Create admin password' : 'Admin password'}</span><input type="password" autoComplete={auth.checked && !auth.configured ? 'new-password' : 'current-password'} minLength={auth.checked && !auth.configured ? 12 : undefined} maxLength="128" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /></label>
                {notice && <div className={`notice ${notice.type}`} role="alert">{notice.text}</div>}
                <button className="primary-button auth-submit">{auth.checked && !auth.configured ? 'Create dashboard access' : 'Sign in'}<ArrowRight size={17} /></button>
              </form>
              <div className="auth-secure"><ShieldCheck size={15} /> Private admin access</div>
            </section>
          ) : (
            <div className="dashboard-wrap">
              <aside className="dashboard-sidebar">
                <div className="sidebar-label">WORKSPACE</div><button className="sidebar-item selected"><LayoutDashboard size={17} /> Overview</button>
                <div className="sidebar-label sidebar-label-lower">MANAGE</div><div className="sidebar-note"><Users size={17} /><span>Registrations</span><b>{summary.total}</b></div>
                <div className="sidebar-bottom"><div className="admin-avatar">SC</div><div><strong>Program admin</strong><span>Student Connect</span></div><button className="icon-button logout-button" title="Sign out" onClick={signOut}><LogOut size={16} /></button></div>
              </aside>
              <section className="dashboard-main">
                <div className="dashboard-heading"><div><span className="section-kicker">OVERVIEW / REGISTRATIONS</span><h1>Student dashboard</h1><p>A clear view of who’s joining your campus network.</p></div><div className="live-indicator"><span /> Live data</div></div>
                {notice && <div className={`notice ${notice.type}`} role="status">{notice.text}</div>}
                <div className="stat-grid">
                  <article className="stat-card stat-primary"><div className="stat-top"><span>Total registrations</span><span className="stat-icon"><Users size={18} /></span></div><strong>{summary.total}</strong><div className="stat-bottom"><span>All student submissions</span><span className="stat-trend"><ArrowUpRight size={14} /> Updated live</span></div></article>
                  <article className="stat-card"><div className="stat-top"><span>Mobile verified</span><span className="stat-icon green"><Phone size={17} /></span></div><strong>{students.filter((student) => student.mobileStatus === 'verified').length}<small> / {students.length}</small></strong><div className="stat-bottom"><span>In the current view</span><span className="stat-trend muted">Contact status</span></div></article>
                  <article className="stat-card"><div className="stat-top"><span>Email verified</span><span className="stat-icon orange"><Mail size={17} /></span></div><strong>{students.filter((student) => student.emailStatus === 'verified').length}<small> / {students.length}</small></strong><div className="stat-bottom"><span>In the current view</span><span className="stat-trend muted">Contact status</span></div></article>
                </div>
                <div className="insight-grid">
                  <section className="insight-panel"><div className="panel-heading"><div><span className="section-kicker">CAMPUS MIX</span><h2>Registrations by college</h2></div><span className="panel-count">{summary.byCollege.length} colleges</span></div><div className="college-bars">{colleges.filter((college) => summary.byCollege.some((item) => item.college === college)).map((college, index) => { const count = summary.byCollege.find((item) => item.college === college)?.count || 0; const max = Math.max(1, ...summary.byCollege.map((item) => item.count)); return <div className="bar-row" key={college}><span className="bar-color" data-tone={index % 4} /><span className="bar-name">{college}</span><span className="bar-track"><i style={{ width: `${Math.max(4, count / max * 100)}%` }} /></span><b>{count}</b></div> })}{summary.byCollege.length === 0 && <div className="empty-chart">Your college breakdown will appear here.</div>}</div></section>
                  <section className="insight-panel year-panel"><div className="panel-heading"><div><span className="section-kicker">YEAR OF STUDY</span><h2>Where they are now</h2></div><span className="panel-count">{summary.total} total</span></div><div className="year-grid">{years.map((year, index) => { const count = summary.byYear.find((item) => item.year === year)?.count || 0; return <button className={`year-cell tone-${index}`} key={year} onClick={() => setFilterYear(filterYear === year ? '' : year)} aria-pressed={filterYear === year}><span>{year}</span><strong>{count}</strong><span className="year-bar"><i style={{ width: `${summary.total ? count / summary.total * 100 : 0}%` }} /></span></button> })}</div></section>
                </div>
                <section className="records-panel"><div className="records-heading"><div><span className="section-kicker">STUDENT DIRECTORY</span><h2>Recent registrations <span>{summary.total}</span></h2></div><label className="search-field"><span className="sr-only">Search students</span><input placeholder="Search name, email or mobile" value={search} onChange={(event) => { setLoading(true); setSearch(event.target.value) }} /><span>/</span></label></div>
                  <div className="filter-row"><span>Filter by</span><label><span className="sr-only">College</span><select value={filterCollege} onChange={(event) => setFilterCollege(event.target.value)}><option value="">All colleges</option>{colleges.map((college) => <option key={college}>{college}</option>)}</select><ChevronDown size={14} /></label><label><span className="sr-only">Year</span><select value={filterYear} onChange={(event) => setFilterYear(event.target.value)}><option value="">All study years</option>{years.map((year) => <option key={year}>{year}</option>)}</select><ChevronDown size={14} /></label><button className="clear-filters" onClick={() => { setFilterCollege(''); setFilterYear(''); setSearch('') }}>Clear filters <X size={13} /></button><span className="result-count">{visibleStudents.length} results</span></div>
                  <div className="table-scroll"><table><thead><tr><th>STUDENT</th><th>COLLEGE / YEAR</th><th>MOBILE STATUS</th><th>EMAIL STATUS</th><th>REGISTERED</th></tr></thead><tbody>{loading ? <tr><td colSpan="5" className="table-message">Loading registrations…</td></tr> : visibleStudents.length ? visibleStudents.map((student) => <tr key={student.id}><td><div className="student-name"><span className="student-avatar">{student.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><strong>{student.name}</strong><small>{student.email}</small><small>{student.mobile}</small></span></div></td><td><strong className="college-cell">{student.college}</strong><small className="year-cell-label">{student.year}</small></td><td><select className={`status-select ${student.mobileStatus}`} value={student.mobileStatus} onChange={(event) => updateStatus(student, 'mobile', event.target.value)}><option value="pending">Pending</option><option value="verified">Verified</option></select></td><td><select className={`status-select ${student.emailStatus}`} value={student.emailStatus} onChange={(event) => updateStatus(student, 'email', event.target.value)}><option value="not_sent">Not sent</option><option value="sent">Email sent</option><option value="verified">Verified</option></select></td><td className="date-cell">{new Date(`${student.createdAt.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td></tr>) : <tr><td colSpan="5" className="table-message">{students.length ? 'No students match those filters.' : 'No registrations yet. Student submissions will appear here.'}</td></tr>}</tbody></table></div>
                </section>
                <div className="dashboard-foot"><ShieldCheck size={14} /> Personal information is encrypted in storage and visible only to admins.<span>Statuses are updated manually; no verification messages are sent.</span></div>
              </section>
            </div>
          )}
        </main>
      )}
    </div>
  )
}

export default App