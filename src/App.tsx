import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  ClipboardList,
  FileText,
  HeartPulse,
  Hospital,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  LogOut,
  Mail,
  Map,
  Navigation,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  UsersRound,
  Wifi,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, ZoomControl } from 'react-leaflet';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api, fetchBootstrap, googleAuthUrl } from './api';
import { AuthProvider, useAuth } from './auth';
import type {
  AdminPayload,
  Appointment,
  AppointmentStatus,
  BootstrapPayload,
  DashboardPayload,
  Integration,
  PatientProfile,
  QueueEntry,
  QueueStatus,
  RecordItem,
  TriageCase,
  TriageRisk,
  TriageStatus,
  Unit,
} from './types';

const markerIcon = L.divIcon({
  className: 'health-marker',
  html: '<span></span>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <PortalPage page="home" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/mapa"
            element={
              <ProtectedRoute>
                <PortalPage page="map" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/cadastro"
            element={
              <ProtectedRoute>
                <PortalPage page="profile" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/prontuarios"
            element={
              <ProtectedRoute>
                <PortalPage page="records" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/triagem"
            element={
              <ProtectedRoute>
                <PortalPage page="triage" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/fila"
            element={
              <ProtectedRoute>
                <PortalPage page="queue" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute role="admin">
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/app'} replace />;
}

function ProtectedRoute({ children, role }: { children: React.ReactNode; role?: 'admin' }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/app" replace />;
  return children;
}

function AuthCallback() {
  const { consumeToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    const isNewUser = new URLSearchParams(window.location.search).get('newUser') === '1';
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }

    consumeToken(token)
      .then((user) => navigate(user.role === 'admin' ? '/admin' : isNewUser ? '/app/triagem' : '/app', { replace: true }))
      .catch(() => navigate('/login', { replace: true }));
  }, [consumeToken, navigate]);

  return <FullPageLoader label="Conectando sua conta..." />;
}

function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchBootstrap().then(setBootstrap).catch(() => undefined);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      const user =
        mode === 'login'
          ? await login({ email, password })
          : await register({ name, email, password });
      navigate(user.role === 'admin' ? '/admin' : mode === 'register' ? '/app/triagem' : '/app', { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao autenticar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-visual" aria-label="Resumo da plataforma">
        <BrandLockup />
        <div className="live-board">
          <div className="live-board-header">
            <span>Rede conectada</span>
            <strong>94%</strong>
          </div>
          <div className="pulse-line">
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="mini-grid">
            <div>
              <Hospital size={20} />
              <strong>32</strong>
              <span>unidades</span>
            </div>
            <div>
              <CalendarDays size={20} />
              <strong>148</strong>
              <span>agendamentos</span>
            </div>
            <div>
              <FileText size={20} />
              <strong>2.4k</strong>
              <span>registros</span>
            </div>
          </div>
        </div>
        <div className="auth-copy">
          <h1>SaúdeConnect</h1>
          <p>
            Sistema integrado para atendimento, mapa de unidades, cadastro, prontuários,
            triagem digital e acompanhamento da fila.
          </p>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="segmented" role="tablist" aria-label="Tipo de acesso">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')} type="button">
              <LockKeyhole size={16} />
              Entrar
            </button>
            <button
              className={mode === 'register' ? 'active' : ''}
              onClick={() => setMode('register')}
              type="button"
            >
              <UserPlus size={16} />
              Criar conta
            </button>
          </div>

          <form onSubmit={submit} className="auth-form">
            <div>
              <p className="eyebrow">Acesso seguro</p>
              <h2>{mode === 'login' ? 'Entre no portal' : 'Crie seu cadastro'}</h2>
            </div>

            {mode === 'register' && (
              <label>
                Nome completo
                <span>
                  <CircleUserRound size={18} />
                  <input value={name} onChange={(event) => setName(event.target.value)} required />
                </span>
              </label>
            )}

            <label>
              E-mail
              <span>
                <Mail size={18} />
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                  required
                />
              </span>
            </label>

            <label>
              Senha
              <span>
                <KeyRound size={18} />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
              </span>
            </label>

            {message && <div className="form-message error">{message}</div>}

            <button className="primary-action" type="submit" disabled={busy}>
              {busy ? <RefreshCw size={18} className="spin" /> : <ChevronRight size={18} />}
              {mode === 'login' ? 'Entrar agora' : 'Cadastrar e entrar'}
            </button>
          </form>

          <div className="oauth-area">
            <a className="google-button" href={googleAuthUrl()}>
              <ShieldCheck size={18} />
              Entrar com Google
            </a>
            {!bootstrap?.googleEnabled && (
              <small>O fluxo está pronto; falta cadastrar as credenciais OAuth no ambiente publicado.</small>
            )}
          </div>

        </div>
      </section>
    </main>
  );
}

type PortalPageName = 'home' | 'map' | 'profile' | 'records' | 'triage' | 'queue';

function PortalPage({ page }: { page: PortalPageName }) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    api<DashboardPayload>('/dashboard')
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar dados.'));

  useEffect(() => {
    void load();
  }, []);

  if (!data) {
    return <DashboardShell title="SaúdeConnect">{error ? <EmptyState message={error} /> : <PanelLoader />}</DashboardShell>;
  }

  return (
    <DashboardShell title={pageTitle(page)} subtitle={pageSubtitle(page)}>
      {page === 'home' && <HomePage data={data} onReload={load} />}
      {page === 'map' && <MapPage units={data.units} />}
      {page === 'profile' && <ProfilePage profile={data.profile} onSaved={load} />}
      {page === 'records' && <RecordsPage records={data.records} exams={data.exams} onCreated={load} />}
      {page === 'triage' && <TriagePage triage={data.triage} onCreated={load} />}
      {page === 'queue' && <QueuePage queue={data.queue} units={data.units} onCreated={load} />}
    </DashboardShell>
  );
}

function HomePage({ data, onReload }: { data: DashboardPayload; onReload: () => Promise<void> }) {
  return (
    <>
      <section className="metrics-grid">
        <MetricCard icon={<CalendarDays />} label="Próximas consultas" value={data.metrics.nextAppointments} tone="blue" />
        <MetricCard icon={<FileText />} label="Resultados disponíveis" value={data.metrics.availableResults} tone="green" />
        <MetricCard icon={<Stethoscope />} label="Triagens ativas" value={data.metrics.activeTriage} tone="orange" />
        <MetricCard icon={<ListChecks />} label="Posição na fila" value={data.metrics.queuePosition} tone="purple" />
      </section>

      <section className="content-grid">
        <div className="stack">
          <SectionHeader icon={<CalendarDays />} title="Sua agenda" />
          <div className="card-list">
            {data.appointments.map((appointment) => (
              <AppointmentCard key={appointment.id} appointment={appointment} />
            ))}
          </div>
        </div>
        <AppointmentForm units={data.units} onCreated={onReload} />
      </section>

      <section className="units-band">
        <SectionHeader icon={<Bell />} title="Comunicados" />
        <div className="unit-grid">
          {data.announcements.map((announcement) => (
            <article className="unit-card" key={announcement.id}>
              <div className="unit-topline">
                <strong>{announcement.title}</strong>
                <span>{formatDate(announcement.published_at, false)}</span>
              </div>
              <p>{announcement.body}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function MapPage({ units }: { units: Unit[] }) {
  const [selectedId, setSelectedId] = useState(units[0]?.id || '');
  const selected = units.find((unit) => unit.id === selectedId) || units[0];
  const center: [number, number] = selected ? [selected.lat, selected.lng] : [-23.5505, -46.6333];

  return (
    <section className="map-layout">
      <aside className="map-list">
        <div>
          <h2>Unidades de Saúde</h2>
          <p>Encontre a unidade mais próxima de você</p>
        </div>
        <div className="map-cards">
          {units.map((unit) => (
            <button
              className={`map-unit-card ${unit.id === selectedId ? 'active' : ''}`}
              key={unit.id}
              type="button"
              onClick={() => setSelectedId(unit.id)}
            >
              <div>
                <strong>{unit.name}</strong>
                <span>{unit.type}</span>
              </div>
              <StatusBadge status={unit.status} />
              <small>{unit.distance_km.toFixed(1)} km</small>
              <p>{unit.address}</p>
              <small>{unit.hours} · {unit.phone}</small>
            </button>
          ))}
        </div>
      </aside>

      <div className="map-panel">
        <MapContainer center={center} zoom={14} className="leaflet-map" zoomControl={false}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ZoomControl position="bottomright" />
          {units.map((unit) => (
            <Marker
              eventHandlers={{ click: () => setSelectedId(unit.id) }}
              icon={markerIcon}
              key={unit.id}
              position={[unit.lat, unit.lng]}
            >
              <Popup>
                <div className="map-popup">
                  <strong>{unit.name}</strong>
                  <span>{unit.type}</span>
                  <p>{unit.address}</p>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${unit.lat},${unit.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Navigation size={16} />
                    Como Chegar
                  </a>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {selected && (
          <article className="selected-map-card">
            <div>
              <strong>{selected.name}</strong>
              <span>{selected.type}</span>
            </div>
            <p>{selected.address}</p>
            <div className="chip-row">
              <span className="chip">{selected.status}</span>
              <span className="chip">{selected.distance_km.toFixed(1)} km</span>
              <span className="chip">{selected.phone}</span>
            </div>
            <a
              className="primary-action map-route"
              href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              <Navigation size={18} />
              Como Chegar
            </a>
          </article>
        )}
      </div>
    </section>
  );
}

function ProfilePage({ profile, onSaved }: { profile: PatientProfile; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    cpf: profile.cpf || '',
    birthDate: profile.birth_date || '',
    phone: profile.phone || '',
    susCard: profile.sus_card || '',
    address: profile.address || '',
    emergencyContact: profile.emergency_contact || '',
  });
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    try {
      await api('/profile', { method: 'PUT', body: form });
      setMessage('Cadastro atualizado com sucesso.');
      await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar cadastro.');
    }
  }

  return (
    <form className="form-grid-panel" onSubmit={submit}>
      <SectionHeader icon={<UserPlus />} title="Cadastro do cidadão" />
      <label>
        CPF
        <input value={form.cpf} onChange={(event) => setForm({ ...form, cpf: event.target.value })} />
      </label>
      <label>
        Data de nascimento
        <input
          type="date"
          value={form.birthDate}
          onChange={(event) => setForm({ ...form, birthDate: event.target.value })}
        />
      </label>
      <label>
        Telefone
        <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
      </label>
      <label>
        Cartão SUS
        <input value={form.susCard} onChange={(event) => setForm({ ...form, susCard: event.target.value })} />
      </label>
      <label className="full-span">
        Endereço
        <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
      </label>
      <label className="full-span">
        Contato de emergência
        <input
          value={form.emergencyContact}
          onChange={(event) => setForm({ ...form, emergencyContact: event.target.value })}
        />
      </label>
      {message && <div className="form-message full-span">{message}</div>}
      <button className="primary-action" type="submit">
        <Save size={18} />
        Salvar cadastro
      </button>
    </form>
  );
}

function RecordsPage({
  exams,
  onCreated,
  records,
}: {
  exams: DashboardPayload['exams'];
  onCreated: () => Promise<void>;
  records: RecordItem[];
}) {
  const [category, setCategory] = useState('Histórico');
  const [title, setTitle] = useState('Nova evolução clínica');
  const [description, setDescription] = useState('Paciente relata melhora após orientações da equipe.');
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    try {
      await api('/records', { method: 'POST', body: { category, title, description } });
      setMessage('Registro adicionado ao prontuário.');
      await onCreated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao registrar prontuário.');
    }
  }

  return (
    <section className="content-grid">
      <div className="timeline">
        <SectionHeader icon={<ClipboardList />} title="Prontuários" />
        {[...records, ...exams]
          .sort((a, b) => Date.parse('requested_at' in b ? b.requested_at : b.created_at) - Date.parse('requested_at' in a ? a.requested_at : a.created_at))
          .map((item) => (
            <div className="timeline-item" key={item.id}>
              <span className="timeline-dot" />
              <div>
                <strong>{item.title}</strong>
                <p>{'status' in item ? `${item.status} em ${item.unit}` : item.description}</p>
                <small>{formatDate('requested_at' in item ? item.requested_at : item.created_at)}</small>
              </div>
            </div>
          ))}
      </div>
      <form className="action-panel" onSubmit={submit}>
        <SectionHeader icon={<Plus />} title="Adicionar registro" />
        <label>
          Categoria
          <input value={category} onChange={(event) => setCategory(event.target.value)} required />
        </label>
        <label>
          Título
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label>
          Descrição
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} required />
        </label>
        {message && <div className="form-message">{message}</div>}
        <button className="primary-action" type="submit">
          <FileText size={18} />
          Salvar registro
        </button>
      </form>
    </section>
  );
}

function TriagePage({ onCreated, triage }: { onCreated: () => Promise<void>; triage: TriageCase[] }) {
  const [symptoms, setSymptoms] = useState('Febre, dor no corpo e tosse há dois dias.');
  const [riskLevel, setRiskLevel] = useState<TriageRisk>('medium');
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    try {
      await api('/triage', { method: 'POST', body: { symptoms, riskLevel } });
      setMessage('Triagem registrada e enviada para a equipe.');
      await onCreated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao registrar triagem.');
    }
  }

  return (
    <section className="content-grid">
      <div className="stack">
        <SectionHeader icon={<Stethoscope />} title="Triagens recentes" />
        <div className="card-list">
          {triage.map((item) => (
            <article className="appointment-card" key={item.id}>
              <span className="icon-tile">
                <Activity size={20} />
              </span>
              <div>
                <div className="card-title-line">
                  <strong>{riskLabel(item.risk_level)}</strong>
                  <StatusBadge status={item.status} />
                </div>
                <p>{item.symptoms}</p>
                <small>{item.recommendation}</small>
              </div>
            </article>
          ))}
        </div>
      </div>
      <form className="action-panel" onSubmit={submit}>
        <SectionHeader icon={<Plus />} title="Nova triagem" />
        <label>
          Sintomas
          <textarea value={symptoms} onChange={(event) => setSymptoms(event.target.value)} required />
        </label>
        <label>
          Prioridade percebida
          <select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value as TriageRisk)}>
            <option value="low">Baixa</option>
            <option value="medium">Média</option>
            <option value="high">Alta</option>
            <option value="critical">Emergência</option>
          </select>
        </label>
        {message && <div className="form-message">{message}</div>}
        <button className="primary-action" type="submit">
          <Stethoscope size={18} />
          Enviar triagem
        </button>
      </form>
    </section>
  );
}

function QueuePage({ onCreated, queue, units }: { onCreated: () => Promise<void>; queue: QueueEntry[]; units: Unit[] }) {
  const [unitId, setUnitId] = useState(units[0]?.id || '');
  const [service, setService] = useState('Clínica geral');
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    try {
      await api('/queue', { method: 'POST', body: { unitId, service } });
      setMessage('Entrada adicionada à fila digital.');
      await onCreated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao entrar na fila.');
    }
  }

  return (
    <section className="content-grid">
      <div className="stack">
        <SectionHeader icon={<ListChecks />} title="Fila digital" />
        <div className="queue-board">
          {queue.map((item) => (
            <article className="queue-card" key={item.id}>
              <div>
                <strong>#{item.position}</strong>
                <span>{item.service}</span>
              </div>
              <p>{item.unit_name}</p>
              <small>{item.estimated_minutes} min estimados</small>
              <StatusBadge status={item.status} />
            </article>
          ))}
        </div>
      </div>
      <form className="action-panel" onSubmit={submit}>
        <SectionHeader icon={<Plus />} title="Entrar na fila" />
        <label>
          Unidade
          <select value={unitId} onChange={(event) => setUnitId(event.target.value)} required>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Serviço
          <input value={service} onChange={(event) => setService(event.target.value)} required />
        </label>
        {message && <div className="form-message">{message}</div>}
        <button className="primary-action" type="submit">
          <ListChecks size={18} />
          Entrar na fila
        </button>
      </form>
    </section>
  );
}

function AdminDashboard() {
  const [data, setData] = useState<AdminPayload | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    api<AdminPayload>('/admin/overview')
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar administração.'));

  useEffect(() => {
    void load();
  }, []);

  async function updateAppointment(id: string, status: AppointmentStatus) {
    await api(`/admin/appointments/${id}`, { method: 'PATCH', body: { status } });
    await load();
  }

  async function updateTriage(id: string, status: TriageStatus) {
    await api(`/admin/triage/${id}`, { method: 'PATCH', body: { status } });
    await load();
  }

  async function updateQueue(id: string, status: QueueStatus) {
    await api(`/admin/queue/${id}`, { method: 'PATCH', body: { status } });
    await load();
  }

  async function updateIntegration(id: string, status: Integration['status']) {
    await api(`/admin/integrations/${id}`, { method: 'PATCH', body: { status } });
    await load();
  }

  if (!data) return <DashboardShell title="Administração">{error ? <EmptyState message={error} /> : <PanelLoader />}</DashboardShell>;

  return (
    <DashboardShell title="Administração" subtitle="Operação, demanda, triagem, fila e integrações em tempo real.">
      <section className="metrics-grid">
        <MetricCard icon={<UsersRound />} label="Usuários" value={data.overview.users} tone="blue" />
        <MetricCard icon={<CalendarDays />} label="Agendamentos" value={data.overview.appointments} tone="green" />
        <MetricCard icon={<Stethoscope />} label="Triagens abertas" value={data.overview.triageWaiting} tone="orange" />
        <MetricCard icon={<ListChecks />} label="Fila aguardando" value={data.overview.queueWaiting} tone="purple" />
      </section>

      <section className="admin-grid">
        <AdminTable title="Agenda da rede" icon={<CalendarDays />}>
          {data.appointments.map((appointment) => (
            <div className="admin-row" key={appointment.id}>
              <div>
                <strong>{appointment.user_name}</strong>
                <span>{appointment.specialty} - {appointment.unit_name}</span>
              </div>
              <small>{formatDate(appointment.scheduled_at)}</small>
              <select
                value={appointment.status}
                onChange={(event) => void updateAppointment(appointment.id, event.target.value as AppointmentStatus)}
              >
                <option value="pending">Pendente</option>
                <option value="confirmed">Confirmado</option>
                <option value="completed">Concluído</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>
          ))}
        </AdminTable>

        <AdminTable title="Triagem" icon={<Stethoscope />} compact>
          {data.triage.map((item) => (
            <div className="admin-row" key={item.id}>
              <div>
                <strong>{item.user_name}</strong>
                <span>{riskLabel(item.risk_level)} - {item.symptoms}</span>
              </div>
              <select value={item.status} onChange={(event) => void updateTriage(item.id, event.target.value as TriageStatus)}>
                <option value="waiting">Aguardando</option>
                <option value="in_service">Em atendimento</option>
                <option value="resolved">Resolvida</option>
              </select>
            </div>
          ))}
        </AdminTable>
      </section>

      <section className="admin-grid">
        <AdminTable title="Fila" icon={<ListChecks />}>
          {data.queue.map((item) => (
            <div className="admin-row" key={item.id}>
              <div>
                <strong>#{item.position} - {item.user_name}</strong>
                <span>{item.service} - {item.unit_name}</span>
              </div>
              <small>{item.estimated_minutes} min</small>
              <select value={item.status} onChange={(event) => void updateQueue(item.id, event.target.value as QueueStatus)}>
                <option value="waiting">Aguardando</option>
                <option value="called">Chamado</option>
                <option value="done">Finalizado</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>
          ))}
        </AdminTable>

        <AdminTable title="Integrações" icon={<Wifi />} compact>
          {data.integrations.map((integration) => (
            <div className="admin-row" key={integration.id}>
              <div>
                <strong>{integration.name}</strong>
                <span>{integration.latency_ms} ms - última sync {formatDate(integration.last_sync, false)}</span>
              </div>
              <StatusBadge status={integration.status} />
              <select
                value={integration.status}
                onChange={(event) => void updateIntegration(integration.id, event.target.value as Integration['status'])}
              >
                <option value="online">Online</option>
                <option value="degraded">Instável</option>
                <option value="offline">Offline</option>
              </select>
            </div>
          ))}
        </AdminTable>
      </section>
    </DashboardShell>
  );
}

function DashboardShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  const { user, logout } = useAuth();
  const homePath = user?.role === 'admin' ? '/admin' : '/app';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <BrandLockup small />
        <nav>
          <NavLink end to={homePath}>
            <LayoutDashboard size={18} />
            Início
          </NavLink>
          <NavLink to="/app/mapa">
            <Map size={18} />
            Mapa
          </NavLink>
          <NavLink to="/app/cadastro">
            <UserPlus size={18} />
            Cadastro
          </NavLink>
          <NavLink to="/app/prontuarios">
            <FileText size={18} />
            Prontuários
          </NavLink>
          <NavLink to="/app/triagem">
            <Stethoscope size={18} />
            Triagem
          </NavLink>
          <NavLink to="/app/fila">
            <ListChecks size={18} />
            Fila
          </NavLink>
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{user?.role === 'admin' ? 'Gestão da rede' : 'Sistema Integrado'}</p>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="user-pill">
            <Bell size={18} />
            <Avatar label={user?.avatar || user?.name || 'SC'} />
            <span>{user?.name}</span>
            <button type="button" onClick={logout} aria-label="Sair">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function BrandLockup({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand-lockup ${small ? 'small' : ''}`}>
      <div className="brand-mark">
        <HeartPulse size={small ? 22 : 26} />
      </div>
      <div>
        <strong>SaúdeConnect</strong>
        <span>Sistema Integrado</span>
      </div>
    </div>
  );
}

function AppointmentForm({ units, onCreated }: { units: Unit[]; onCreated: () => Promise<void> }) {
  const [unitId, setUnitId] = useState(units[0]?.id || '');
  const [specialty, setSpecialty] = useState('Clínica geral');
  const [scheduledAt, setScheduledAt] = useState(nextDateInput());
  const [reason, setReason] = useState('Preciso de acompanhamento de rotina.');
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    try {
      await api('/appointments', { method: 'POST', body: { unitId, specialty, scheduledAt, reason } });
      setMessage('Pedido enviado para confirmação.');
      await onCreated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao solicitar agendamento.');
    }
  }

  return (
    <form className="action-panel" onSubmit={submit}>
      <SectionHeader icon={<Plus />} title="Solicitar agendamento" />
      <label>
        Unidade
        <select value={unitId} onChange={(event) => setUnitId(event.target.value)} required>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Especialidade
        <input value={specialty} onChange={(event) => setSpecialty(event.target.value)} required />
      </label>
      <label>
        Data desejada
        <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} required />
      </label>
      <label>
        Motivo
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} required />
      </label>
      {message && <div className="form-message">{message}</div>}
      <button className="primary-action" type="submit">
        <CalendarDays size={18} />
        Enviar pedido
      </button>
    </form>
  );
}

function AppointmentCard({ appointment }: { appointment: Appointment }) {
  return (
    <article className="appointment-card">
      <div>
        <span className="icon-tile">
          <CalendarDays size={20} />
        </span>
      </div>
      <div>
        <div className="card-title-line">
          <strong>{appointment.specialty}</strong>
          <StatusBadge status={appointment.status} />
        </div>
        <p>{appointment.unit_name} - {appointment.professional}</p>
        <small>{formatDate(appointment.scheduled_at)} - {appointment.reason}</small>
      </div>
    </article>
  );
}

function MetricCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <p>{label}</p>
      </div>
    </article>
  );
}

function SectionHeader({ icon, title, action }: { icon: React.ReactNode; title: string; action?: string }) {
  return (
    <div className="section-header">
      <div>
        <span>{icon}</span>
        <h2>{title}</h2>
      </div>
      {action && <small>{action}</small>}
    </div>
  );
}

function AdminTable({
  children,
  compact = false,
  icon,
  title,
}: {
  children: React.ReactNode;
  compact?: boolean;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <section className={`admin-panel ${compact ? 'compact' : ''}`}>
      <SectionHeader icon={icon} title={title} />
      <div className="admin-list">{children}</div>
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: 'Pendente',
    confirmed: 'Confirmado',
    completed: 'Concluído',
    cancelled: 'Cancelado',
    waiting: 'Aguardando',
    in_service: 'Em atendimento',
    resolved: 'Resolvido',
    called: 'Chamado',
    done: 'Finalizado',
    online: 'Online',
    degraded: 'Instável',
    offline: 'Offline',
    Aberto: 'Aberto',
    'Coleta até 16h': 'Coleta até 16h',
    'Plantão reduzido': 'Plantão reduzido',
  };
  return <span className={`status-badge status-${statusClass(status)}`}>{labels[status] || status}</span>;
}

function statusClass(status: string) {
  if (['confirmed', 'resolved', 'online', 'completed', 'done', 'called', 'Aberto'].includes(status)) return 'ok';
  if (['pending', 'waiting', 'degraded', 'Coleta até 16h', 'Plantão reduzido'].includes(status)) return 'warn';
  if (['cancelled', 'offline', 'critical'].includes(status)) return 'danger';
  if (status === 'in_service') return 'info';
  return 'default';
}

function Avatar({ label }: { label: string }) {
  const initials = useMemo(
    () =>
      label
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase(),
    [label],
  );
  return <span className="avatar">{initials}</span>;
}

function FullPageLoader({ label = 'Carregando...' }: { label?: string }) {
  return (
    <div className="full-loader">
      <HeartPulse size={32} />
      <span>{label}</span>
    </div>
  );
}

function PanelLoader() {
  return (
    <div className="panel-loader">
      <RefreshCw className="spin" size={24} />
      <span>Sincronizando dados...</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <AlertTriangle size={24} />
      <strong>{message}</strong>
    </div>
  );
}

function pageTitle(page: PortalPageName) {
  return {
    home: 'Início',
    map: 'Unidades de Saúde',
    profile: 'Cadastro',
    records: 'Prontuários',
    triage: 'Triagem',
    queue: 'Fila',
  }[page];
}

function pageSubtitle(page: PortalPageName) {
  return {
    home: 'Resumo do atendimento, próximos passos e avisos importantes.',
    map: 'Encontre a unidade mais próxima de você',
    profile: 'Mantenha seus dados atualizados para agilizar o atendimento.',
    records: 'Histórico clínico, exames e registros de cuidado.',
    triage: 'Informe sintomas e acompanhe a classificação de prioridade.',
    queue: 'Acompanhe sua posição e entre na fila digital das unidades.',
  }[page];
}

function riskLabel(risk: TriageRisk) {
  return {
    low: 'Prioridade verde',
    medium: 'Prioridade amarela',
    high: 'Prioridade laranja',
    critical: 'Prioridade vermelha',
  }[risk];
}

function formatDate(value: string, includeTime = true) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value));
}

function nextDateInput() {
  const date = new Date(Date.now() + 86400000 * 3);
  date.setMinutes(0, 0, 0);
  return date.toISOString().slice(0, 16);
}

export default App;
