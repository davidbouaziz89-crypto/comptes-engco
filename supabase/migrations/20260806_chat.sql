-- Chat interne "gestion" : schéma, fonctions, RLS, Realtime, storage.
-- Base unified-backend (lrslisyydbiejqzpsoxc).

-- ===== Tables =====
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct','group')),
  title text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table if not exists public.chat_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  role text not null default 'member',
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  sender_email text,
  body text,
  created_at timestamptz not null default now(),
  deleted boolean not null default false
);
create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  path text not null,
  name text,
  mime text,
  size integer
);
create index if not exists idx_chat_messages_conv on public.chat_messages(conversation_id, created_at);
create index if not exists idx_chat_members_user on public.chat_members(user_id);
create index if not exists idx_chat_conv_last on public.chat_conversations(last_message_at desc);

-- ===== Helpers SECURITY DEFINER (évitent la récursion RLS) =====
create or replace function public.chat_is_member(conv uuid, uid uuid)
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.chat_members m where m.conversation_id=conv and m.user_id=uid);
$$;

create or replace function public.chat_get_or_create_direct(other uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare me uuid := auth.uid(); conv uuid;
begin
  if me is null or other is null or me=other then raise exception 'invalid'; end if;
  select c.id into conv from public.chat_conversations c
    where c.type='direct'
      and exists(select 1 from public.chat_members a where a.conversation_id=c.id and a.user_id=me)
      and exists(select 1 from public.chat_members b where b.conversation_id=c.id and b.user_id=other)
    limit 1;
  if conv is not null then return conv; end if;
  insert into public.chat_conversations(type, created_by) values('direct', me) returning id into conv;
  insert into public.chat_members(conversation_id, user_id, email)
    values (conv, me, (select email from auth.users where id=me)),
           (conv, other, (select email from auth.users where id=other));
  return conv;
end; $$;

create or replace function public.chat_create_group(p_title text, p_members uuid[])
returns uuid language plpgsql security definer set search_path=public as $$
declare me uuid := auth.uid(); conv uuid; u uuid;
begin
  if me is null then raise exception 'auth'; end if;
  insert into public.chat_conversations(type, title, created_by) values('group', coalesce(nullif(p_title,''),'Groupe'), me) returning id into conv;
  insert into public.chat_members(conversation_id, user_id, email, role)
    values (conv, me, (select email from auth.users where id=me), 'admin');
  foreach u in array coalesce(p_members,'{}') loop
    if u <> me then
      insert into public.chat_members(conversation_id, user_id, email)
        values (conv, u, (select email from auth.users where id=u))
        on conflict do nothing;
    end if;
  end loop;
  return conv;
end; $$;

create or replace function public.chat_mark_read(conv uuid)
returns void language sql security definer set search_path=public as $$
  update public.chat_members set last_read_at=now()
   where conversation_id=conv and user_id=auth.uid();
$$;

-- ===== RLS =====
alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_attachments enable row level security;

drop policy if exists conv_sel on public.chat_conversations;
create policy conv_sel on public.chat_conversations for select using (public.chat_is_member(id, auth.uid()));

drop policy if exists mem_sel on public.chat_members;
create policy mem_sel on public.chat_members for select using (public.chat_is_member(conversation_id, auth.uid()));
drop policy if exists mem_upd on public.chat_members;
create policy mem_upd on public.chat_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists msg_sel on public.chat_messages;
create policy msg_sel on public.chat_messages for select using (public.chat_is_member(conversation_id, auth.uid()));
drop policy if exists msg_ins on public.chat_messages;
create policy msg_ins on public.chat_messages for insert with check (public.chat_is_member(conversation_id, auth.uid()) and sender_id = auth.uid());

drop policy if exists att_sel on public.chat_attachments;
create policy att_sel on public.chat_attachments for select using (
  exists(select 1 from public.chat_messages m where m.id=message_id and public.chat_is_member(m.conversation_id, auth.uid())));
drop policy if exists att_ins on public.chat_attachments;
create policy att_ins on public.chat_attachments for insert with check (
  exists(select 1 from public.chat_messages m where m.id=message_id and m.sender_id=auth.uid()));

-- ===== Realtime =====
do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.chat_members;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.chat_conversations;
exception when duplicate_object then null; end $$;

-- ===== Storage : bucket privé chat-files + policies =====
insert into storage.buckets (id, name, public) values ('chat-files','chat-files', false)
  on conflict (id) do nothing;

drop policy if exists chatfiles_sel on storage.objects;
create policy chatfiles_sel on storage.objects for select using (
  bucket_id='chat-files' and public.chat_is_member( (split_part(name,'/',1))::uuid, auth.uid() ));
drop policy if exists chatfiles_ins on storage.objects;
create policy chatfiles_ins on storage.objects for insert with check (
  bucket_id='chat-files' and public.chat_is_member( (split_part(name,'/',1))::uuid, auth.uid() ));
