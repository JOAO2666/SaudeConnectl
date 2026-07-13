import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createClient } from '@libsql/client';

const defaultDataDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'saudeconnect-data')
  : path.resolve(process.cwd(), 'data');

export const dataDir = process.env.DATA_DIR || defaultDataDir;

if (!process.env.TURSO_DATABASE_URL) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(dataDir, 'saudeconnect.sqlite')}`,
  authToken: process.env.TURSO_AUTH_TOKEN
});

function normalizeArgs(args) {
  if (Array.isArray(args) && args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0]) && !(args[0] instanceof Date)) {
    return args[0];
  }
  return args;
}

export async function dbGet(sql, args = []) {
  const result = await db.execute({ sql, args: normalizeArgs(args) });
  return result.rows[0];
}

export async function dbAll(sql, args = []) {
  const result = await db.execute({ sql, args: normalizeArgs(args) });
  return result.rows;
}

export async function dbRun(sql, args = []) {
  const result = await db.execute({ sql, args: normalizeArgs(args) });
  return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
}

const now = () => new Date().toISOString();

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    provider: user.provider,
    createdAt: user.created_at,
    lastLogin: user.last_login,
    lastSeen: user.last_seen || user.last_login || null,
  };
}

export async function initDb() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL CHECK (role IN ('user', 'admin', 'support')) DEFAULT 'user',
      avatar TEXT,
      provider TEXT NOT NULL DEFAULT 'local',
      google_id TEXT UNIQUE,
      created_at TEXT NOT NULL,
      last_login TEXT,
      cpf TEXT
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      ip_address TEXT,
      user_agent TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_id ON auth_sessions(token_id);

    CREATE TABLE IF NOT EXISTS units (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      city TEXT NOT NULL,
      district TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT NOT NULL,
      status TEXT NOT NULL,
      services TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      specialty TEXT NOT NULL,
      professional TEXT,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')) DEFAULT 'pending',
      reason TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (unit_id) REFERENCES units(id)
    );

    CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      unit TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      status TEXT NOT NULL,
      result_url TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS patient_profiles (
      user_id TEXT PRIMARY KEY,
      cpf TEXT,
      birth_date TEXT,
      phone TEXT,
      sus_card TEXT,
      address TEXT,
      emergency_contact TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS triage_cases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      queue_id TEXT NOT NULL,
      temperature TEXT,
      sys_bp TEXT,
      dia_bp TEXT,
      heart_rate TEXT,
      resp_rate TEXT,
      spo2 TEXT,
      glucose TEXT,
      chief_complaint TEXT NOT NULL,
      manchester_color TEXT NOT NULL CHECK (manchester_color IN ('Azul', 'Verde', 'Amarelo', 'Laranja', 'Vermelho')),
      status TEXT NOT NULL DEFAULT 'resolved',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (queue_id) REFERENCES queue_entries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS queue_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      service TEXT NOT NULL,
      chief_complaint TEXT,
      position INTEGER NOT NULL,
      estimated_minutes INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('waiting_triage', 'waiting_service', 'called', 'done', 'cancelled')) DEFAULT 'waiting_triage',
      triage_color TEXT,
      triage_time TEXT,
      deadline_time TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (unit_id) REFERENCES units(id)
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'in_review', 'resolved')) DEFAULT 'open',
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      audience TEXT NOT NULL CHECK (audience IN ('all', 'users', 'admins')) DEFAULT 'all',
      published_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('online', 'degraded', 'offline')) DEFAULT 'online',
      last_sync TEXT NOT NULL,
      latency_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  await ensureColumn('units', 'distance_km', 'REAL NOT NULL DEFAULT 0');
  await ensureColumn('units', 'hours', "TEXT NOT NULL DEFAULT 'Seg-Sex: 7h às 17h'");
  await ensureColumn('units', 'lat', 'REAL NOT NULL DEFAULT -23.5505');
  await ensureColumn('units', 'lng', 'REAL NOT NULL DEFAULT -46.6333');
  await ensureColumn('users', 'last_seen', 'TEXT');
  await ensureColumn('users', 'cpf', 'TEXT');
  await ensureColumn('triage_cases', 'creator_name', 'TEXT');
  await ensureColumn('triage_cases', 'unit_id', 'TEXT');
  await ensureColumn('records', 'creator_name', 'TEXT');

  await seedDb();
}

async function ensureColumn(table, column, definition) {
  const result = await db.execute(`PRAGMA table_info(${table})`);
  const columns = result.rows.map((item) => item.name);
  if (!columns.includes(column)) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function seedDb() {
  const seedTime = now();
  await upsertUser({
    id: 'usr_admin',
    name: 'Administrador',
    email: 'admin@saudeconnect.com',
    password_hash: bcrypt.hashSync('Admin@12345', 12),
    role: 'admin',
    avatar: 'AD',
    created_at: seedTime,
    last_login: seedTime,
    last_seen: seedTime,
  });

  await upsertUser({
    id: 'usr_paciente',
    name: 'Paciente',
    email: 'paciente@saudeconnect.com',
    password_hash: bcrypt.hashSync('Paciente@12345', 12),
    role: 'user',
    avatar: 'PA',
    created_at: seedTime,
    last_login: seedTime,
    last_seen: seedTime,
  });

  const unitsData = [
    {
      id: 'unit_upa_petrolina',
      name: 'UPA Petrolina',
      type: 'Pronto Atendimento',
      city: 'Petrolina',
      district: 'Gercino Coelho',
      address: 'Avenida Coronel Antônio Honorato Viana, s/n',
      phone: '(87) 3866-9603',
      status: 'Aberto',
      distance_km: 1.0,
      hours: '24 horas',
      lat: -9.381335,
      lng: -40.485121,
      services: ['Emergencia', 'Triagem', 'Enfermagem'],
    },
    {
      id: 'unit_dom_malan',
      name: 'Hospital Dom Malan',
      type: 'Hospital',
      city: 'Petrolina',
      district: 'Centro',
      address: 'Avenida Joaquim Nabuco, s/n',
      phone: '(87) 3862-2222',
      status: 'Aberto',
      distance_km: 2.1,
      hours: '24 horas',
      lat: -9.3945738,
      lng: -40.4997125,
      services: ['Pediatria', 'Maternidade', 'Urgencia'],
    },
    {
      id: 'unit_upa_juazeiro',
      name: 'UPA Juazeiro',
      type: 'Pronto Atendimento',
      city: 'Juazeiro',
      district: 'Castelo Branco',
      address: 'Rodovia Lomanto Júnior, KM 4',
      phone: '(74) 3613-4288',
      status: 'Aberto',
      distance_km: 4.8,
      hours: '24 horas',
      lat: -9.38978519068669,
      lng: -40.524348024976725,
      services: ['Traumatologia', 'Urgencia', 'Cirurgia'],
    },
    {
      id: 'unit_hospital_regional_juazeiro',
      name: 'Hospital Regional de Juazeiro',
      type: 'Hospital',
      city: 'Juazeiro',
      district: 'Santo Antonio',
      address: 'Travessa do Hospital, s/n',
      phone: '(74) 3614-8350',
      status: 'Aberto',
      distance_km: 5.2,
      hours: '24 horas',
      lat: -9.4141581,
      lng: -40.5109149,
      services: ['Clinica Medica', 'Cirurgia Geral'],
    }
  ];

  for (const unit of unitsData) {
    await upsertUnit(unit);
  }
}

async function upsertUser(user) {
  const exists = await dbGet('SELECT id FROM users WHERE id = :id', { id: user.id });
  if (exists) {
    await dbRun(`
      UPDATE users
      SET name = :name, email = :email, password_hash = :password_hash, role = :role, avatar = :avatar,
          last_login = COALESCE(:last_login, last_login), last_seen = COALESCE(:last_seen, last_seen), cpf = COALESCE(:cpf, cpf)
      WHERE id = :id
    `, { cpf: null, ...user });
    return;
  }

  await dbRun(`
    INSERT INTO users (id, name, email, password_hash, role, avatar, provider, created_at, last_login, last_seen, cpf)
    VALUES (:id, :name, :email, :password_hash, :role, :avatar, 'local', :created_at, :last_login, :last_seen, :cpf)
  `, { cpf: null, ...user });
}

async function upsertUnit(unit) {
  await dbRun(`
    INSERT INTO units (id, name, type, city, district, address, phone, status, services, distance_km, hours, lat, lng, created_at)
    VALUES (:id, :name, :type, :city, :district, :address, :phone, :status, :services, :distance_km, :hours, :lat, :lng, :created_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      city = excluded.city,
      district = excluded.district,
      address = excluded.address,
      phone = excluded.phone,
      status = excluded.status,
      services = excluded.services,
      distance_km = excluded.distance_km,
      hours = excluded.hours,
      lat = excluded.lat,
      lng = excluded.lng
  `, {
    ...unit,
    services: JSON.stringify(unit.services),
    created_at: now(),
  });
}

export async function upsertProfile(profile) {
  await dbRun(`
    INSERT INTO patient_profiles (user_id, cpf, birth_date, phone, sus_card, address, emergency_contact, updated_at)
    VALUES (:user_id, :cpf, :birth_date, :phone, :sus_card, :address, :emergency_contact, :updated_at)
    ON CONFLICT(user_id) DO UPDATE SET
      cpf = excluded.cpf,
      birth_date = excluded.birth_date,
      phone = excluded.phone,
      sus_card = excluded.sus_card,
      address = excluded.address,
      emergency_contact = excluded.emergency_contact,
      updated_at = excluded.updated_at
  `, profile);
}

export async function logAudit(actorId, action, entity, entityId) {
  await dbRun(`
    INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, created_at)
    VALUES (:id, :actor_id, :action, :entity, :entity_id, :created_at)
  `, {
    id: crypto.randomUUID(),
    actor_id: actorId,
    action,
    entity,
    entity_id: entityId,
    created_at: now(),
  });
}
