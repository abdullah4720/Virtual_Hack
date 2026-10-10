-- شغّل هذا الملف كاملًا في Supabase → SQL Editor (آمن لإعادة التشغيل)
-- كل الجداول تُقرأ وتُكتب من الخادم فقط بمفتاح service role، لذلك نفعّل RLS دون سياسات عامة.

-- ===== إعدادات البرنامج (تُدار من لوحة التحكم) =====
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ===== المستثمر الذكي =====
create table if not exists deals (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,
  title text,
  idea text,
  investor text,
  decision text not null check (decision in ('invest','out')),
  amount bigint default 0,
  equity numeric default 0,
  valuation bigint default 0,
  verdict text,
  score int
);
alter table deals add column if not exists idea text;
alter table deals add column if not exists email text;
alter table deals add column if not exists scores jsonb;
alter table deals add column if not exists qualified boolean default false;
create index if not exists deals_email_idx on deals (email);

-- ===== تذاكر التأهل للهاكاثون (من المستثمر الذكي أو دعوات المنظمين) =====
create table if not exists tickets (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  code text not null unique,
  kind text not null,               -- investor | invite
  name text, email text, label text,
  deal_id bigint,
  used_by_team bigint,
  used_at timestamptz
);
alter table tickets enable row level security;

-- ===== الهاكاثون الافتراضي =====
create table if not exists hack_teams (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  code text not null unique,
  name text not null,
  members jsonb not null default '[]',
  email text,
  phone text,
  track text,
  challenge text,
  source text default 'direct',     -- direct | investor
  deal_id bigint                     -- الفكرة الأصلية في المستثمر الذكي إن وُجدت
);
alter table hack_teams add column if not exists track text;
alter table hack_teams add column if not exists source text default 'direct';
alter table hack_teams add column if not exists deal_id bigint;
alter table hack_teams add column if not exists files jsonb not null default '[]';   -- الملفات الحالية للفريق
alter table hack_teams add column if not exists ticket text;   -- رمز التأهل المستخدم في التسجيل

create table if not exists hack_submissions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  team_id bigint not null references hack_teams(id) on delete cascade,
  attempt int not null,
  title text, problem text, solution text, customer text, business text,
  prototype_desc text, prototype_url text, video_url text,
  ai_scores jsonb, ai_total int, ai_feedback jsonb,
  flagged boolean default false,
  files jsonb default '[]',          -- نسخة من ملفات الفريق لحظة التقديم
  deck_read boolean default false    -- هل قرأ الذكاء الاصطناعي العرض الاستثماري
);
alter table hack_submissions add column if not exists files jsonb default '[]';
alter table hack_submissions add column if not exists deck_read boolean default false;

create table if not exists hack_judge_scores (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  team_id bigint not null references hack_teams(id) on delete cascade,
  judge text not null,
  score int not null check (score between 0 and 100),
  note text
);

alter table app_settings enable row level security;
alter table deals enable row level security;
alter table hack_teams enable row level security;
alter table hack_submissions enable row level security;
alter table hack_judge_scores enable row level security;

create index if not exists deals_created_idx on deals (created_at desc);
create index if not exists hack_subs_team_idx on hack_submissions (team_id);

-- ===== تخزين الملفات (العروض الاستثمارية والملفات الإضافية) =====
-- حاوية خاصة (غير عامة): الرفع والتنزيل بروابط موقّعة مؤقتة فقط
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hackathon', 'hackathon', false, 52428800, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png', 'image/jpeg'
])
on conflict (id) do nothing;

-- ===== الإصدار 2: التحصين والمنصة المتكاملة =====
alter table deals add column if not exists consent_at timestamptz;

alter table hack_teams add column if not exists status text not null default 'active';   -- active | disqualified
alter table hack_teams add column if not exists consent_at timestamptz;
alter table hack_teams add column if not exists certs jsonb;                              -- رموز الشهادات لكل عضو

alter table hack_submissions add column if not exists status text not null default 'done'; -- pending | done | failed
alter table hack_submissions add column if not exists eval_error text;
alter table hack_submissions add column if not exists evaluated_at timestamptz;

alter table hack_judge_scores add column if not exists judge_id text;
alter table hack_judge_scores add column if not exists criteria jsonb;   -- درجات المحكّم لكل معيار
alter table hack_judge_scores add column if not exists coi boolean default false;  -- تعارض مصالح

-- سجل الاستخدام (حدود الطلبات وسقف الذكاء الاصطناعي اليومي)
create table if not exists usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ip text, kind text
);
create index if not exists usage_created_idx on usage (created_at);
create index if not exists usage_ip_idx on usage (ip, kind, created_at);

-- رموز التحقق من البريد
create table if not exists otp (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  email text not null, code_hash text not null, expires_at timestamptz not null
);
create index if not exists otp_email_idx on otp (email);

-- الإعلانات والإشعارات
create table if not exists announcements (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  title text not null, body text,
  audience text not null default 'all',   -- all | participants | judges | screens | team:<id>
  active boolean not null default true
);

alter table usage enable row level security;
alter table otp enable row level security;
alter table announcements enable row level security;
