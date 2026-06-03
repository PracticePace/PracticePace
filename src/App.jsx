import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { OrgProvider } from './context/OrgContext'
import ProtectedRoute from './components/ProtectedRoute'
import LandingPage from './pages/LandingPage'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Display from './pages/Display'
import Script from './pages/Script'
import Scoreboard from './pages/Scoreboard'
import Admin from './pages/Admin'
import AcceptInvite from './pages/AcceptInvite'
import Pricing      from './pages/Pricing'
import ResetPassword from './pages/ResetPassword'

// Root-route gate: signed-in users skip directly to /dashboard (preserves
// today's behavior for active coaches); signed-out users see the marketing
// landing page. While AuthContext is still restoring the session we show
// the same centered spinner ProtectedRoute uses so returning users don't
// flash the landing page for one frame before being redirected.
function RootRoute() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#080000' }}>
        <div
          className="w-8 h-8 rounded-full border-2 animate-spin"
          style={{ borderColor: '#cc1111', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }
  if (user) return <Navigate to="/dashboard" replace />
  return <LandingPage />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <OrgProvider>
          <Routes>
            {/* / — marketing landing for signed-out visitors; redirect
                to /dashboard for signed-in users (preserves today's
                landing behavior for active coaches). The Login page
                used to live at "/"; it now lives at /login below and
                its inline signin/signup mode toggle is unchanged.
                ProtectedRoute still redirects unauthenticated users to
                "/" — they get the marketing page instead of the Login
                screen, which is the new desired funnel. */}
            <Route path="/"           element={<RootRoute />} />
            <Route path="/login"      element={<Login />} />
            <Route path="/pricing"    element={<Pricing />} />
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
            <Route path="/dashboard"  element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/display"    element={<ProtectedRoute><Display /></ProtectedRoute>} />
            <Route path="/script"     element={<ProtectedRoute><Script /></ProtectedRoute>} />
            <Route path="/scoreboard" element={<ProtectedRoute><Scoreboard /></ProtectedRoute>} />
            <Route path="/admin"      element={<ProtectedRoute><Admin /></ProtectedRoute>} />
            <Route path="/invite"         element={<AcceptInvite />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Routes>
        </OrgProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
