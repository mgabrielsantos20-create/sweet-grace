-- Sweet Grace: banco do painel da confeiteira.
-- Rode este arquivo inteiro uma vez no Supabase (SQL Editor > New query > Run).
-- Pode rodar de novo sem perder dados: ele só cria o que ainda não existe.

-- 1. Quem pode entrar no painel. Troque o e-mail no fim deste arquivo.
create table if not exists equipe (
  email text primary key
);

create or replace function eh_equipe() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from equipe where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- 2. Cardápio
create table if not exists sabores (
  id text primary key,
  nome text not null,
  disponivel boolean not null default true,
  ordem int not null default 0
);

insert into sabores (id, nome, ordem) values
  ('brigadeiro', 'Brigadeiro tradicional', 1),
  ('beijinho', 'Beijinho de coco', 2),
  ('bicho-de-pe', 'Bicho de pé', 3),
  ('ninho', 'Brigadeiro de Ninho', 4),
  ('cajuzinho', 'Cajuzinho', 5),
  ('casadinho', 'Casadinho', 6)
on conflict (id) do nothing;

-- 3. Preços (uma linha só)
create table if not exists config (
  id int primary key default 1 check (id = 1),
  preco_unidade numeric(8,2) not null default 2.00,
  preco_cento numeric(8,2) not null default 150.00
);
insert into config (id) values (1) on conflict (id) do nothing;

-- 4. Dias sem vaga (o site não aceita pedido para esses dias)
create table if not exists dias_bloqueados (
  data date primary key,
  motivo text
);

-- 5. Pedidos
create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null,
  criado_em timestamptz not null default now(),
  origem text not null default 'site' check (origem in ('site', 'manual')),
  cliente_nome text,
  cliente_telefone text,
  itens jsonb not null default '[]',
  total_docinhos int not null default 0,
  valor numeric(10,2) not null default 0,
  frete numeric(10,2) not null default 0,
  data_festa date,
  entrega text not null default 'a_combinar' check (entrega in ('a_combinar', 'retirada', 'entrega')),
  endereco text,
  observacoes text,
  anotacoes text,
  status text not null default 'novo'
    check (status in ('novo', 'aguardando_sinal', 'confirmado', 'em_producao', 'pronto', 'entregue', 'cancelado')),
  sinal_pago boolean not null default false,
  restante_pago boolean not null default false
);
create index if not exists pedidos_data_festa on pedidos (data_festa);

-- 6. Depoimentos (só aparecem no site depois de publicados no painel)
create table if not exists depoimentos (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  nome text not null,
  festa text,
  texto text not null,
  autorizado boolean not null default false,
  publicado boolean not null default false,
  pedido_codigo text
);

-- Segurança: ninguém de fora lê pedidos. Visitantes só leem o cardápio,
-- os preços, os dias bloqueados e os depoimentos publicados.
alter table equipe enable row level security;
alter table sabores enable row level security;
alter table config enable row level security;
alter table dias_bloqueados enable row level security;
alter table pedidos enable row level security;
alter table depoimentos enable row level security;

drop policy if exists "equipe ve equipe" on equipe;
create policy "equipe ve equipe" on equipe for select to authenticated using (eh_equipe());

drop policy if exists "todos leem sabores" on sabores;
create policy "todos leem sabores" on sabores for select using (true);
drop policy if exists "equipe edita sabores" on sabores;
create policy "equipe edita sabores" on sabores for all to authenticated using (eh_equipe()) with check (eh_equipe());

drop policy if exists "todos leem config" on config;
create policy "todos leem config" on config for select using (true);
drop policy if exists "equipe edita config" on config;
create policy "equipe edita config" on config for update to authenticated using (eh_equipe()) with check (eh_equipe());

drop policy if exists "todos leem bloqueios" on dias_bloqueados;
create policy "todos leem bloqueios" on dias_bloqueados for select using (true);
drop policy if exists "equipe edita bloqueios" on dias_bloqueados;
create policy "equipe edita bloqueios" on dias_bloqueados for all to authenticated using (eh_equipe()) with check (eh_equipe());

drop policy if exists "equipe cuida dos pedidos" on pedidos;
create policy "equipe cuida dos pedidos" on pedidos for all to authenticated using (eh_equipe()) with check (eh_equipe());

drop policy if exists "todos leem depoimentos publicados" on depoimentos;
create policy "todos leem depoimentos publicados" on depoimentos for select using (publicado or eh_equipe());
drop policy if exists "equipe cuida dos depoimentos" on depoimentos;
create policy "equipe cuida dos depoimentos" on depoimentos for all to authenticated using (eh_equipe()) with check (eh_equipe());

-- O site grava pedidos e depoimentos só por estas duas funções,
-- que conferem os dados e nunca deixam o visitante ler nada.
create or replace function criar_pedido(
  p_codigo text, p_nome text, p_itens jsonb, p_data_festa date, p_observacoes text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total int := 0;
  v_item jsonb;
  v_itens jsonb := '[]';
  v_q int;
  v_nome text;
  c config%rowtype;
begin
  if p_codigo !~ '^[A-Z0-9]{4,8}$' then raise exception 'codigo invalido'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 20 then raise exception 'itens invalidos'; end if;
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_q := (v_item ->> 'qtd')::int;
    select nome into v_nome from sabores where id = v_item ->> 'id' and disponivel;
    if v_nome is null or v_q is null or v_q <= 0 or v_q > 5000 then raise exception 'item invalido'; end if;
    v_total := v_total + v_q;
    v_itens := v_itens || jsonb_build_object('id', v_item ->> 'id', 'nome', v_nome, 'qtd', v_q);
  end loop;
  if v_total < 10 then raise exception 'pedido minimo'; end if;
  if exists (select 1 from dias_bloqueados where data = p_data_festa) then raise exception 'data sem vaga'; end if;
  select * into c from config where id = 1;
  insert into pedidos (codigo, origem, cliente_nome, itens, total_docinhos, valor, data_festa, observacoes)
  values (
    p_codigo, 'site', left(nullif(trim(p_nome), ''), 80), v_itens, v_total,
    (v_total / 100) * c.preco_cento + (v_total % 100) * c.preco_unidade,
    p_data_festa, left(nullif(trim(p_observacoes), ''), 1000)
  )
  on conflict (codigo) do nothing;
end;
$$;

create or replace function enviar_depoimento(
  p_nome text, p_festa text, p_texto text, p_autorizado boolean, p_pedido text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_nome), '') = '' or coalesce(trim(p_texto), '') = '' then raise exception 'faltam dados'; end if;
  if not coalesce(p_autorizado, false) then raise exception 'sem autorizacao'; end if;
  insert into depoimentos (nome, festa, texto, autorizado, pedido_codigo)
  values (left(trim(p_nome), 60), left(nullif(trim(p_festa), ''), 80), left(trim(p_texto), 600), true, left(nullif(trim(p_pedido), ''), 12));
end;
$$;

revoke all on function criar_pedido(text, text, jsonb, date, text) from public;
revoke all on function enviar_depoimento(text, text, text, boolean, text) from public;
grant execute on function criar_pedido(text, text, jsonb, date, text) to anon, authenticated;
grant execute on function enviar_depoimento(text, text, text, boolean, text) to anon, authenticated;
revoke all on function eh_equipe() from public;
grant execute on function eh_equipe() to anon, authenticated;

-- 7. TROQUE pelo e-mail que a confeiteira vai usar para entrar no painel.
insert into equipe (email) values ('email-da-confeiteira@exemplo.com') on conflict do nothing;
