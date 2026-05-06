import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { OrgProvider } from './context/OrgContext'
import ProtectedRoute from './components/ProtectedRoute'
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <OrgProvider>
          <Routes>
            <Route path="/"           element={<Login />} />
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
