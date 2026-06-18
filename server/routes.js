import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { z } from 'zod';
import { authRequired, adminRequired, signToken } from './auth.js';
import { db, logAudit, publicUser } from './db.js';

const router = express.Router();
const now = () => new Date().toISOString();

const googleEnabled =
  Boolean(process.env.GOOGLE_CLIENT_ID) &&
  Boolean(process.env.GOOGLE_CLIENT_SECRET) &&
  Boolean(process.env.GOOGLE_CALLBACK_URL);

if (googleEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          if (!email) return done(null, false);

          const existing = db
            .prepare('SELECT * FROM users WHERE google_id = ? OR email = ?')
            .get(profile.id, email);

          if (existing) {
            db.prepare(
              'UPDATE users SET google_id = ?, provider = ?, avatar = COALESCE(avatar, ?), last_login = ? WHERE id = ?',
            ).run(profile.id, 'google', initials(profile.displayName), now(), existing.id);

            const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
            logAudit(existing.id, 'logged_in_google', 'users', existing.id);
            return done(null, { ...refreshed, is_new_user: false });
          }

          const user = {
            id: crypto.randomUUID(),
            name: profile.displayName || email.split('@')[0],
            email,
            avatar: initials(profile.displayName || email),
            created_at: now(),
          };

          db.prepare(`
            INSERT INTO users (id, name, email, password_hash, role, avatar, provider, google_id, created_at, last_login)
            VALUES (@id, @name, @email, NULL, 'user', @avatar, 'google', @google_id, @created_at, @last_login)
          `).run({ ...user, google_id: profile.id, last_login: user.created_at });

          const created = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
          logAudit(user.id, 'registered_google', 'users', user.id);
          return done(null, { ...created, is_new_user: true });
        } catch (error) {
          return done(error);
        }
      },
    ),
  );
}

const registerSchema = z.object({
  name: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const appointmentSchema = z.object({
  unitId: z.string().min(1),
  specialty: z.string().min(2),
  scheduledAt: z.string().min(6),
  reason: z.string().min(6),
});

const ticketSchema = z.object({
  subject: z.string().min(4),
  message: z.string().min(8),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

const profileSchema = z.object({
  cpf: z.string().min(3).optional().default(''),
  birthDate: z.string().optional().default(''),
  phone: z.string().min(3).optional().default(''),
  susCard: z.string().optional().default(''),
  address: z.string().optional().default(''),
  emergencyContact: z.string().optional().default(''),
});

const recordSchema = z.object({
  category: z.string().min(2),
  title: z.string().min(3),
  description: z.string().min(6),
});

const triageSchema = z.object({
  symptoms: z.string().min(8),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});

const queueSchema = z.object({
  unitId: z.string().min(1),
  service: z.string().min(2),
});

const statusSchema = z.object({
  status: z.string().min(2),
});

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'SaudeConnect API', time: now() });
});

router.get('/bootstrap', (_req, res) => {
  res.json({
    googleEnabled,
  });
});

router.post('/auth/register', (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const email = input.email.toLowerCase();
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

    if (exists) {
      return res.status(409).json({ message: 'E-mail ja cadastrado.' });
    }

    const user = {
      id: crypto.randomUUID(),
      name: input.name,
      email,
      password_hash: bcrypt.hashSync(input.password, 12),
      role: 'user',
      avatar: initials(input.name),
      created_at: now(),
      last_login: now(),
    };

    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, avatar, provider, created_at, last_login)
      VALUES (@id, @name, @email, @password_hash, @role, @avatar, 'local', @created_at, @last_login)
    `).run(user);

    const token = signToken(user);
    logAudit(user.id, 'registered', 'users', user.id);
    return res.status(201).json({ user: publicUser(user), token });
  } catch (error) {
    return next(error);
  }
});

router.post('/auth/login', (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(input.email.toLowerCase());

    if (!user || !user.password_hash || !bcrypt.compareSync(input.password, user.password_hash)) {
      return res.status(401).json({ message: 'Credenciais invalidas.' });
    }

    db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), user.id);
    const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    logAudit(user.id, 'logged_in', 'users', user.id);
    return res.json({ user: publicUser(refreshed), token: signToken(refreshed) });
  } catch (error) {
    return next(error);
  }
});

router.get('/auth/google', (req, res, next) => {
  if (!googleEnabled) {
    return res.status(503).json({
      message: 'Login Google indisponivel. Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_CALLBACK_URL.',
    });
  }

  return passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
});

router.get(
  '/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login?oauth=failed' }),
  (req, res) => {
    const token = signToken(req.user);
    const forwardedProto = req.get('x-forwarded-proto') || req.protocol;
    const forwardedHost = req.get('x-forwarded-host') || req.get('host');
    const clientUrl = process.env.CLIENT_URL || `${forwardedProto}://${forwardedHost}`;
    const params = new URLSearchParams({ token });
    if (req.user?.is_new_user) params.set('newUser', '1');
    res.redirect(`${clientUrl}/auth/callback?${params.toString()}`);
  },
);

router.get('/auth/me', authRequired, (req, res) => {
  res.json({ user: req.publicUser });
});

router.get('/units', authRequired, (_req, res) => {
  const units = listUnits();
  res.json({ units });
});

router.get('/dashboard', authRequired, (req, res) => {
  const appointments = appointmentsForUser(req.user.id);
  const exams = db.prepare('SELECT * FROM exams WHERE user_id = ? ORDER BY requested_at DESC').all(req.user.id);
  const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  const profile = profileForUser(req.user.id);
  const triage = triageForUser(req.user.id);
  const queue = queueForUser(req.user.id);
  const tickets = db
    .prepare('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  const units = listUnits();
  const announcements = db
    .prepare("SELECT * FROM announcements WHERE audience IN ('all', 'users') ORDER BY published_at DESC LIMIT 4")
    .all();

  res.json({
    user: req.publicUser,
    metrics: {
      nextAppointments: appointments.filter((item) => ['pending', 'confirmed'].includes(item.status)).length,
      availableResults: exams.filter((item) => item.status.toLowerCase().includes('disponivel')).length,
      activeTickets: tickets.filter((item) => item.status !== 'resolved').length,
      connectedUnits: units.length,
      activeTriage: triage.filter((item) => item.status !== 'resolved').length,
      queuePosition: queue.find((item) => item.status === 'waiting')?.position || 0,
    },
    appointments,
    exams,
    records,
    profile,
    triage,
    queue,
    tickets,
    units,
    announcements,
  });
});

router.get('/profile', authRequired, (req, res) => {
  res.json({ profile: profileForUser(req.user.id) });
});

router.put('/profile', authRequired, (req, res, next) => {
  try {
    const input = profileSchema.parse(req.body);
    db.prepare(`
      INSERT INTO patient_profiles (user_id, cpf, birth_date, phone, sus_card, address, emergency_contact, updated_at)
      VALUES (@user_id, @cpf, @birth_date, @phone, @sus_card, @address, @emergency_contact, @updated_at)
      ON CONFLICT(user_id) DO UPDATE SET
        cpf = excluded.cpf,
        birth_date = excluded.birth_date,
        phone = excluded.phone,
        sus_card = excluded.sus_card,
        address = excluded.address,
        emergency_contact = excluded.emergency_contact,
        updated_at = excluded.updated_at
    `).run({
      user_id: req.user.id,
      cpf: input.cpf,
      birth_date: input.birthDate,
      phone: input.phone,
      sus_card: input.susCard,
      address: input.address,
      emergency_contact: input.emergencyContact,
      updated_at: now(),
    });

    logAudit(req.user.id, 'updated', 'patient_profiles', req.user.id);
    return res.json({ profile: profileForUser(req.user.id) });
  } catch (error) {
    return next(error);
  }
});

router.get('/records', authRequired, (req, res) => {
  const records = db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ records });
});

router.post('/records', authRequired, (req, res, next) => {
  try {
    const input = recordSchema.parse(req.body);
    const record = {
      id: crypto.randomUUID(),
      user_id: req.user.id,
      category: input.category,
      title: input.title,
      description: input.description,
      created_at: now(),
    };

    db.prepare(`
      INSERT INTO records (id, user_id, category, title, description, created_at)
      VALUES (@id, @user_id, @category, @title, @description, @created_at)
    `).run(record);

    logAudit(req.user.id, 'created', 'records', record.id);
    return res.status(201).json({ record });
  } catch (error) {
    return next(error);
  }
});

router.get('/triage', authRequired, (req, res) => {
  res.json({ triage: triageForUser(req.user.id) });
});

router.post('/triage', authRequired, (req, res, next) => {
  try {
    const input = triageSchema.parse(req.body);
    const recommendation = recommendationForRisk(input.riskLevel);
    const triageCase = {
      id: crypto.randomUUID(),
      user_id: req.user.id,
      symptoms: input.symptoms,
      risk_level: input.riskLevel,
      status: input.riskLevel === 'critical' ? 'in_service' : 'waiting',
      recommendation,
      created_at: now(),
    };

    db.prepare(`
      INSERT INTO triage_cases (id, user_id, symptoms, risk_level, status, recommendation, created_at)
      VALUES (@id, @user_id, @symptoms, @risk_level, @status, @recommendation, @created_at)
    `).run(triageCase);

    logAudit(req.user.id, 'created', 'triage_cases', triageCase.id);
    return res.status(201).json({ triage: triageCase });
  } catch (error) {
    return next(error);
  }
});

router.get('/queue', authRequired, (req, res) => {
  res.json({ queue: queueForUser(req.user.id) });
});

router.post('/queue', authRequired, (req, res, next) => {
  try {
    const input = queueSchema.parse(req.body);
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(input.unitId);
    if (!unit) return res.status(404).json({ message: 'Unidade não encontrada.' });

    const nextPosition =
      db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next FROM queue_entries WHERE unit_id = ? AND status = 'waiting'")
        .get(input.unitId).next || 1;
    const queueEntry = {
      id: crypto.randomUUID(),
      user_id: req.user.id,
      unit_id: input.unitId,
      service: input.service,
      position: nextPosition,
      estimated_minutes: nextPosition * 9 + 7,
      status: 'waiting',
      created_at: now(),
    };

    db.prepare(`
      INSERT INTO queue_entries (id, user_id, unit_id, service, position, estimated_minutes, status, created_at)
      VALUES (@id, @user_id, @unit_id, @service, @position, @estimated_minutes, @status, @created_at)
    `).run(queueEntry);

    logAudit(req.user.id, 'created', 'queue_entries', queueEntry.id);
    return res.status(201).json({ queue: queueById(queueEntry.id) });
  } catch (error) {
    return next(error);
  }
});

router.post('/appointments', authRequired, (req, res, next) => {
  try {
    const input = appointmentSchema.parse(req.body);
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(input.unitId);

    if (!unit) {
      return res.status(404).json({ message: 'Unidade nao encontrada.' });
    }

    const appointment = {
      id: crypto.randomUUID(),
      user_id: req.user.id,
      unit_id: input.unitId,
      specialty: input.specialty,
      professional: 'A definir',
      scheduled_at: new Date(input.scheduledAt).toISOString(),
      status: 'pending',
      reason: input.reason,
      notes: '',
      created_at: now(),
    };

    db.prepare(`
      INSERT INTO appointments (id, user_id, unit_id, specialty, professional, scheduled_at, status, reason, notes, created_at)
      VALUES (@id, @user_id, @unit_id, @specialty, @professional, @scheduled_at, @status, @reason, @notes, @created_at)
    `).run(appointment);

    logAudit(req.user.id, 'created', 'appointments', appointment.id);
    return res.status(201).json({ appointment: appointmentById(appointment.id) });
  } catch (error) {
    return next(error);
  }
});

router.post('/support', authRequired, (req, res, next) => {
  try {
    const input = ticketSchema.parse(req.body);
    const ticket = {
      id: crypto.randomUUID(),
      user_id: req.user.id,
      subject: input.subject,
      message: input.message,
      status: 'open',
      priority: input.priority,
      created_at: now(),
    };

    db.prepare(`
      INSERT INTO support_tickets (id, user_id, subject, message, status, priority, created_at)
      VALUES (@id, @user_id, @subject, @message, @status, @priority, @created_at)
    `).run(ticket);

    logAudit(req.user.id, 'created', 'support_tickets', ticket.id);
    return res.status(201).json({ ticket });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin/overview', authRequired, adminRequired, (_req, res) => {
  const overview = {
    users: count('users'),
    appointments: count('appointments'),
    openTickets: db.prepare("SELECT COUNT(*) AS total FROM support_tickets WHERE status != 'resolved'").get().total,
    integrationsOnline: db.prepare("SELECT COUNT(*) AS total FROM integrations WHERE status = 'online'").get().total,
    triageWaiting: db.prepare("SELECT COUNT(*) AS total FROM triage_cases WHERE status != 'resolved'").get().total,
    queueWaiting: db.prepare("SELECT COUNT(*) AS total FROM queue_entries WHERE status = 'waiting'").get().total,
  };

  const appointments = db
    .prepare(`
      SELECT appointments.*, users.name AS user_name, users.email AS user_email, units.name AS unit_name
      FROM appointments
      JOIN users ON users.id = appointments.user_id
      JOIN units ON units.id = appointments.unit_id
      ORDER BY scheduled_at DESC
      LIMIT 12
    `)
    .all();
  const users = db
    .prepare('SELECT id, name, email, role, avatar, provider, created_at, last_login FROM users ORDER BY created_at DESC')
    .all();
  const tickets = db
    .prepare(`
      SELECT support_tickets.*, users.name AS user_name, users.email AS user_email
      FROM support_tickets
      JOIN users ON users.id = support_tickets.user_id
      ORDER BY created_at DESC
    `)
    .all();
  const triage = db
    .prepare(`
      SELECT triage_cases.*, users.name AS user_name, users.email AS user_email
      FROM triage_cases
      JOIN users ON users.id = triage_cases.user_id
      ORDER BY triage_cases.created_at DESC
    `)
    .all();
  const queue = db
    .prepare(`
      SELECT queue_entries.*, users.name AS user_name, users.email AS user_email, units.name AS unit_name
      FROM queue_entries
      JOIN users ON users.id = queue_entries.user_id
      JOIN units ON units.id = queue_entries.unit_id
      ORDER BY queue_entries.status = 'waiting' DESC, queue_entries.position ASC
    `)
    .all();
  const integrations = db.prepare('SELECT * FROM integrations ORDER BY name').all();
  const auditLogs = db
    .prepare(`
      SELECT audit_logs.*, users.name AS actor_name
      FROM audit_logs
      LEFT JOIN users ON users.id = audit_logs.actor_id
      ORDER BY audit_logs.created_at DESC
      LIMIT 10
    `)
    .all();

  res.json({ overview, appointments, users, tickets, triage, queue, integrations, auditLogs });
});

router.patch('/admin/appointments/:id', authRequired, adminRequired, (req, res, next) => {
  try {
    const input = statusSchema.parse(req.body);
    if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(input.status)) {
      return res.status(400).json({ message: 'Status de agendamento invalido.' });
    }

    const result = db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(input.status, req.params.id);
    if (result.changes === 0) return res.status(404).json({ message: 'Agendamento nao encontrado.' });

    logAudit(req.user.id, 'updated_status', 'appointments', req.params.id);
    return res.json({ appointment: appointmentById(req.params.id) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/admin/tickets/:id', authRequired, adminRequired, (req, res, next) => {
  try {
    const input = statusSchema.parse(req.body);
    if (!['open', 'in_review', 'resolved'].includes(input.status)) {
      return res.status(400).json({ message: 'Status de chamado invalido.' });
    }

    const result = db.prepare('UPDATE support_tickets SET status = ? WHERE id = ?').run(input.status, req.params.id);
    if (result.changes === 0) return res.status(404).json({ message: 'Chamado nao encontrado.' });

    logAudit(req.user.id, 'updated_status', 'support_tickets', req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.patch('/admin/integrations/:id', authRequired, adminRequired, (req, res, next) => {
  try {
    const input = statusSchema.parse(req.body);
    if (!['online', 'degraded', 'offline'].includes(input.status)) {
      return res.status(400).json({ message: 'Status de integracao invalido.' });
    }

    const latency = Math.floor(90 + Math.random() * 720);
    const result = db
      .prepare('UPDATE integrations SET status = ?, last_sync = ?, latency_ms = ? WHERE id = ?')
      .run(input.status, now(), latency, req.params.id);
    if (result.changes === 0) return res.status(404).json({ message: 'Integracao nao encontrada.' });

    logAudit(req.user.id, 'updated_status', 'integrations', req.params.id);
    return res.json({ integration: db.prepare('SELECT * FROM integrations WHERE id = ?').get(req.params.id) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/admin/triage/:id', authRequired, adminRequired, (req, res, next) => {
  try {
    const input = statusSchema.parse(req.body);
    if (!['waiting', 'in_service', 'resolved'].includes(input.status)) {
      return res.status(400).json({ message: 'Status de triagem inválido.' });
    }

    const result = db.prepare('UPDATE triage_cases SET status = ? WHERE id = ?').run(input.status, req.params.id);
    if (result.changes === 0) return res.status(404).json({ message: 'Triagem não encontrada.' });

    logAudit(req.user.id, 'updated_status', 'triage_cases', req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.patch('/admin/queue/:id', authRequired, adminRequired, (req, res, next) => {
  try {
    const input = statusSchema.parse(req.body);
    if (!['waiting', 'called', 'done', 'cancelled'].includes(input.status)) {
      return res.status(400).json({ message: 'Status de fila inválido.' });
    }

    const result = db.prepare('UPDATE queue_entries SET status = ? WHERE id = ?').run(input.status, req.params.id);
    if (result.changes === 0) return res.status(404).json({ message: 'Entrada de fila não encontrada.' });

    logAudit(req.user.id, 'updated_status', 'queue_entries', req.params.id);
    return res.json({ queue: queueById(req.params.id) });
  } catch (error) {
    return next(error);
  }
});

function appointmentsForUser(userId) {
  return db
    .prepare(`
      SELECT appointments.*, units.name AS unit_name, units.district AS unit_district, units.phone AS unit_phone
      FROM appointments
      JOIN units ON units.id = appointments.unit_id
      WHERE appointments.user_id = ?
      ORDER BY scheduled_at ASC
    `)
    .all(userId);
}

function appointmentById(id) {
  return db
    .prepare(`
      SELECT appointments.*, users.name AS user_name, users.email AS user_email, units.name AS unit_name
      FROM appointments
      JOIN users ON users.id = appointments.user_id
      JOIN units ON units.id = appointments.unit_id
      WHERE appointments.id = ?
    `)
    .get(id);
}

function listUnits() {
  return db
    .prepare('SELECT * FROM units ORDER BY distance_km ASC, name ASC')
    .all()
    .map(normalizeUnit);
}

function normalizeUnit(unit) {
  return {
    ...unit,
    services: JSON.parse(unit.services),
    distance_km: Number(unit.distance_km),
    lat: Number(unit.lat),
    lng: Number(unit.lng),
  };
}

function profileForUser(userId) {
  return (
    db.prepare('SELECT * FROM patient_profiles WHERE user_id = ?').get(userId) || {
      user_id: userId,
      cpf: '',
      birth_date: '',
      phone: '',
      sus_card: '',
      address: '',
      emergency_contact: '',
      updated_at: now(),
    }
  );
}

function triageForUser(userId) {
  return db.prepare('SELECT * FROM triage_cases WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function queueForUser(userId) {
  return db
    .prepare(`
      SELECT queue_entries.*, units.name AS unit_name, units.address AS unit_address
      FROM queue_entries
      JOIN units ON units.id = queue_entries.unit_id
      WHERE queue_entries.user_id = ?
      ORDER BY queue_entries.status = 'waiting' DESC, queue_entries.created_at DESC
    `)
    .all(userId);
}

function queueById(id) {
  return db
    .prepare(`
      SELECT queue_entries.*, users.name AS user_name, units.name AS unit_name, units.address AS unit_address
      FROM queue_entries
      JOIN users ON users.id = queue_entries.user_id
      JOIN units ON units.id = queue_entries.unit_id
      WHERE queue_entries.id = ?
    `)
    .get(id);
}

function recommendationForRisk(riskLevel) {
  return {
    low: 'Prioridade verde. Acompanhe sintomas e procure atendimento de rotina.',
    medium: 'Prioridade amarela. Procure uma unidade próxima ou aguarde chamada da equipe.',
    high: 'Prioridade laranja. Atendimento prioritário recomendado ainda hoje.',
    critical: 'Prioridade vermelha. Procure emergência imediatamente ou ligue 192.',
  }[riskLevel];
}

function count(table) {
  return db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export default router;
