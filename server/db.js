import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';

const defaultDataDir = process.env.VERCEL
  ? path.join(os.tmpdir(), 'saudeconnect-data')
  : path.resolve(process.cwd(), 'data');

export const dataDir = process.env.DATA_DIR || defaultDataDir;
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'saudeconnect.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

export function initDb() {
  db.exec(`
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
      status TEXT NOT NULL CHECK (status IN ('Aguardando Triagem', 'Triagem realizada', 'done', 'cancelled')) DEFAULT 'Aguardando Triagem',
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

  ensureColumn('units', 'distance_km', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('units', 'hours', "TEXT NOT NULL DEFAULT 'Seg-Sex: 7h às 17h'");
  ensureColumn('units', 'lat', 'REAL NOT NULL DEFAULT -23.5505');
  ensureColumn('units', 'lng', 'REAL NOT NULL DEFAULT -46.6333');
  ensureColumn('users', 'last_seen', 'TEXT');
  ensureColumn('users', 'cpf', 'TEXT');
  ensureColumn('triage_cases', 'creator_name', 'TEXT');
  ensureColumn('triage_cases', 'unit_id', 'TEXT');
  ensureColumn('records', 'creator_name', 'TEXT');

  seedDb();
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function seedDb() {
  const seedTime = now();
  upsertUser({
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

  upsertUser({
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

  [
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
      lat: -9.3888,
      lng: -40.5057,
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
      lat: -9.394730090681888,
      lng: -40.50217682497653,
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
      lat: -9.441179482788714,
      lng: -40.493536160223634,
      services: ['Emergencia', 'Pediatria'],
    },
    {
      id: 'unit_hu_univasf',
      name: 'HU-Univasf',
      type: 'Hospital',
      city: 'Petrolina',
      district: 'Centro',
      address: 'Avenida José de Sá Maniçoba, s/n',
      phone: '(87) 2101-6500',
      status: 'Aberto',
      distance_km: 1.5,
      hours: '24 horas',
      lat: -9.39241419068415,
      lng: -40.499105024976735,
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
      lat: -9.414211490663284,
      lng: -40.513266524976494,
      services: ['Clinica Medica', 'Cirurgia Geral'],
    }
  ].forEach(upsertUnit);
}

function seedOnce(table, id, insert) {
  const exists = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (!exists) insert();
}

function upsertUser(user) {
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(user.id);
  if (exists) {
    db.prepare(`
      UPDATE users
      SET name = @name, email = @email, password_hash = @password_hash, role = @role, avatar = @avatar,
          last_login = COALESCE(@last_login, last_login), last_seen = COALESCE(@last_seen, last_seen), cpf = COALESCE(@cpf, cpf)
      WHERE id = @id
    `).run({ cpf: null, ...user });
    return;
  }

  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, avatar, provider, created_at, last_login, last_seen, cpf)
    VALUES (@id, @name, @email, @password_hash, @role, @avatar, 'local', @created_at, @last_login, @last_seen, @cpf)
  `).run({ cpf: null, ...user });
}

function upsertUnit(unit) {
  db.prepare(`
    INSERT INTO units (id, name, type, city, district, address, phone, status, services, distance_km, hours, lat, lng, created_at)
    VALUES (@id, @name, @type, @city, @district, @address, @phone, @status, @services, @distance_km, @hours, @lat, @lng, @created_at)
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
  `).run({
    ...unit,
    services: JSON.stringify(unit.services),
    created_at: now(),
  });
}

function upsertProfile(profile) {
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
  `).run(profile);
}

export function logAudit(actorId, action, entity, entityId) {
  db.prepare(`
    INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, created_at)
    VALUES (@id, @actor_id, @action, @entity, @entity_id, @created_at)
  `).run({
    id: crypto.randomUUID(),
    actor_id: actorId,
    action,
    entity,
    entity_id: entityId,
    created_at: now(),
  });
}
