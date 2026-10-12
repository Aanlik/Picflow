import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { GalleryAuthProvider, MaintenanceProvider } from './contexts';
import { ThemeProvider } from './contexts/ThemeContext';
import { LegalPage } from './pages/public/LegalPage';
import { RequireFeature } from './components/admin/RequireFeature';
import { PageErrorBoundary, OfflineIndicator, SkipLink, DynamicFavicon, RobotsMetaTags, CMSContentBlock, Loading } from './components/common';
import { MaintenanceWrapper } from './components/MaintenanceWrapper';
import { GlobalThemeProvider } from './components/GlobalThemeProvider';
import { ConfirmDialogProvider } from './components/common';
import { AdminAuthProvider } from './contexts';

const GalleryPage = lazy(() => import('./pages/GalleryPage').then((m) => ({ default: m.GalleryPage })));
const ClientAccessPage = lazy(() => import('./pages/ClientAccessPage').then((m) => ({ default: m.ClientAccessPage })));
const PreviewPage = lazy(() => import('./pages/gallery/PreviewPage').then((m) => ({ default: m.PreviewPage })));
const SlideshowPage = lazy(() => import('./pages/gallery/SlideshowPage').then((m) => ({ default: m.SlideshowPage })));
const AdminLoginPage = lazy(() => import('./pages/admin/AdminLoginPage').then((m) => ({ default: m.AdminLoginPage })));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })));
const EventsListPage = lazy(() => import('./pages/admin/EventsListPage').then((m) => ({ default: m.EventsListPage })));
const CreateEventPage = lazy(() => import('./pages/admin/CreateEventPage').then((m) => ({ default: m.CreateEventPage })));
const EventDetailsPage = lazy(() => import('./pages/admin/EventDetailsPage').then((m) => ({ default: m.EventDetailsPage })));
const ArchivesPage = lazy(() => import('./pages/admin/ArchivesPage').then((m) => ({ default: m.ArchivesPage })));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const LocalUsersPage = lazy(() => import('./pages/admin/LocalUsersPage').then((m) => ({ default: m.LocalUsersPage })));
const TransfersPage = lazy(() => import('./pages/admin/transfers/TransfersPage').then((m) => ({ default: m.TransfersPage })));
const TransferDownloadPage = lazy(() => import('./pages/public/TransferDownloadPage').then((m) => ({ default: m.TransferDownloadPage })));
const TransferUploadPage = lazy(() => import('./pages/public/TransferUploadPage').then((m) => ({ default: m.TransferUploadPage })));
const AdminLayout = lazy(() => import('./components/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })));
const AdminAuthWrapper = lazy(() => import('./components/admin/AdminAuthWrapper').then((m) => ({ default: m.AdminAuthWrapper })));
const SetupPage = lazy(() => import('./pages/SetupPage').then((m) => ({ default: m.SetupPage })));

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function App() {
  // Track dark mode for toast theming
  const [toastTheme, setToastTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setToastTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return (
    <PageErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MaintenanceProvider>
          <ThemeProvider>
            <GlobalThemeProvider>
              <ConfirmDialogProvider>
              <Suspense fallback={<Loading />}>
              <DynamicFavicon />
              <RobotsMetaTags />
              <Router>
                <MaintenanceWrapper>
                  <SkipLink />
                  <Routes>
                  {/* Public gallery routes */}
                  <Route path="/gallery/preview" element={<PreviewPage />} />
                  {/* Live Slideshow ("Diashow") — token-only fullscreen kiosk.
                      Self-manages its session token; no GalleryAuthProvider. */}
                  <Route path="/gallery/:slug/show/:token" element={
                    <Suspense fallback={<Loading />}>
                      <SlideshowPage />
                    </Suspense>
                  } />
                  <Route path="/gallery/:slug/client-access" element={
                    <GalleryAuthProvider>
                      <ClientAccessPage />
                    </GalleryAuthProvider>
                  } />
                  <Route path="/gallery/:slug/:token?" element={
                    <GalleryAuthProvider>
                      <GalleryPage />
                    </GalleryAuthProvider>
                  } />

                  {/* First-run setup — public, self-closes once an admin exists */}
                  <Route path="/setup" element={
                    <AdminAuthProvider>
                      <SetupPage />
                    </AdminAuthProvider>
                  } />

                  {/* Admin routes - wrap with AdminAuthProvider */}
                  <Route path="/admin" element={<AdminAuthWrapper />}>
                    <Route path="login" element={<AdminLoginPage />} />
                    <Route element={<AdminLayout />}>
                      <Route path="dashboard" element={<AdminDashboard />} />
                      <Route path="events" element={<EventsListPage />} />
                      <Route path="events/new" element={<CreateEventPage />} />
                      <Route path="events/:id" element={<EventDetailsPage />} />
                      <Route path="archives" element={<ArchivesPage />} />
                      {/* PicTransfer (#997) — cross-event file transfers.
                          Gated by the `transfers` flag (strictly opt-in). */}
                      <Route element={<RequireFeature flag="transfers" />}>
                        <Route path="transfers" element={<TransfersPage />} />
                      </Route>

                      {/* Feature-gated surfaces — redirect to /admin/dashboard when flag is off. */}
                      <Route element={<RequireFeature flag="userManagement" />}>
                        <Route path="users" element={<LocalUsersPage />} />
                      </Route>

                      <Route path="settings" element={<SettingsPage />} />

                      {/* Old top-level routes — these surfaces now live as
                          Settings tabs (#feature-flags-settings-reorg).
                          Kept indefinitely as redirects so existing bookmarks
                          and external links don't 404. */}
                      <Route path="branding"     element={<Navigate to="/admin/settings?tab=branding"   replace />} />
                      <Route path="backup"       element={<Navigate to="/admin/settings?tab=backup"     replace />} />
                      <Route path="cms"          element={<Navigate to="/admin/settings?tab=cms"        replace />} />

                      <Route index element={<Navigate to="/admin/dashboard" replace />} />
                    </Route>
                  </Route>

                  {/* PicTransfer (#997) — recipient download + client upload,
                      token-only, no auth. */}
                  <Route path="/transfer/:token" element={<TransferDownloadPage />} />
                  <Route path="/transfer-upload/:token" element={<TransferUploadPage />} />

                  <Route path="/customer/*" element={<Navigate to="/" replace />} />

                  {/* Public legal pages */}
                  <Route path="/impressum" element={<LegalPage />} />
                  <Route path="/datenschutz" element={<LegalPage />} />
                  <Route path="/:slug" element={<LegalPage />} />

                  {/* Default redirect */}
                  <Route path="/" element={<Navigate to="/admin/login" replace />} />

                  {/* Customisable 404 (#324) — caught here for any path that
                      didn't match. Top-level `/:slug` is consumed above by
                      LegalPage; this picks up deeper unknown paths. */}
                  <Route path="*" element={<CMSContentBlock slug="not-found" />} />
                  </Routes>
              </MaintenanceWrapper>
            </Router>

            {/* Offline indicator */}
            <OfflineIndicator />

            {/* Toast notifications */}
            <ToastContainer
              position="bottom-right"
              autoClose={3000}
              hideProgressBar={false}
              newestOnTop
              closeOnClick
              rtl={false}
              pauseOnFocusLoss
              draggable
              pauseOnHover
              theme={toastTheme}
            />
              </Suspense>
              </ConfirmDialogProvider>
            </GlobalThemeProvider>
          </ThemeProvider>
        </MaintenanceProvider>
      </QueryClientProvider>
    </PageErrorBoundary>
  );
}

export default App;
