-- Sweet Grace: atualização 2 do banco do painel.
-- Rode este arquivo inteiro uma vez no Supabase (SQL Editor > New query > Run),
-- depois do banco.sql. Pode rodar de novo sem perder dados.

-- Aviso no celular: o banco manda um aviso para o app ntfy a cada pedido novo.
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net indisponivel: avisos no celular ficam desligados';
end $$;

-- 1. Pix, limite por dia
alter table config add column if not exists pix_chave text;
alter table config add column if not exists pix_nome text;
alter table config add column if not exists pix_cidade text default 'BELEM';
alter table config add column if not exists limite_dia int;

-- 2. Sabores com foto, descrição e cor; "ativo" tira o sabor do site sem apagar.
alter table sabores add column if not exists descricao text;
alter table sabores add column if not exists foto_url text;
alter table sabores add column if not exists cor text;
alter table sabores add column if not exists ativo boolean not null default true;

-- 3. Ingredientes, custos e receitas (só a equipe vê)
create table if not exists ingredientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  unidade text not null default 'un',
  custo numeric(10,2) not null default 0,
  criado_em timestamptz not null default now()
);
create table if not exists receitas (
  sabor_id text not null references sabores(id) on delete cascade,
  ingrediente_id uuid not null references ingredientes(id) on delete cascade,
  qtd_por_100 numeric(10,3) not null check (qtd_por_100 > 0),
  primary key (sabor_id, ingrediente_id)
);

-- Começa com as forminhas (1 por docinho) em todos os sabores; o resto ela cadastra no painel.
insert into ingredientes (nome, unidade, custo)
select 'Forminhas', 'un', 0 where not exists (select 1 from ingredientes);
insert into receitas (sabor_id, ingrediente_id, qtd_por_100)
select s.id, i.id, 100 from sabores s, ingredientes i
where i.nome = 'Forminhas' and not exists (select 1 from receitas r where r.sabor_id = s.id)
on conflict do nothing;

-- 4. Aviso de pedido novo (tópico secreto do app ntfy)
create table if not exists avisos (
  id int primary key default 1 check (id = 1),
  ntfy_topico text not null default ('sweetgrace-' || substr(md5(random()::text || clock_timestamp()::text), 1, 20)),
  ligado boolean not null default true
);
insert into avisos (id) values (1) on conflict (id) do nothing;

alter table ingredientes enable row level security;
alter table receitas enable row level security;
alter table avisos enable row level security;

drop policy if exists "equipe cuida dos ingredientes" on ingredientes;
create policy "equipe cuida dos ingredientes" on ingredientes for all to authenticated using (eh_equipe()) with check (eh_equipe());
drop policy if exists "equipe cuida das receitas" on receitas;
create policy "equipe cuida das receitas" on receitas for all to authenticated using (eh_equipe()) with check (eh_equipe());
drop policy if exists "equipe cuida dos avisos" on avisos;
create policy "equipe cuida dos avisos" on avisos for all to authenticated using (eh_equipe()) with check (eh_equipe());

-- 5. Aviso para o celular (não trava o pedido se falhar)
create or replace function avisar_celular(p_titulo text, p_mensagem text) returns void
language plpgsql security definer set search_path = public as $$
declare a avisos%rowtype;
begin
  select * into a from avisos where id = 1;
  if a.id is null or not a.ligado then return; end if;
  begin
    perform net.http_post(
      url := 'https://ntfy.sh',
      body := jsonb_build_object('topic', a.ntfy_topico, 'title', p_titulo, 'message', p_mensagem,
                                 'tags', jsonb_build_array('cake'),
                                 'click', 'https://mgabrielsantos20-create.github.io/sweet-grace/painel/')
    );
  exception when others then
    null;
  end;
end;
$$;
revoke all on function avisar_celular(text, text) from public, anon, authenticated;

-- 6. Pedido do site: sempre salva (mesmo em dia cheio ou sabor esgotado), com um alerta nas anotações.
create or replace function criar_pedido(
  p_codigo text, p_nome text, p_itens jsonb, p_data_festa date, p_observacoes text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total int := 0;
  v_item jsonb;
  v_itens jsonb := '[]';
  v_q int;
  s sabores%rowtype;
  c config%rowtype;
  v_alertas text[] := '{}';
  v_ocupado int;
  v_nome text := left(nullif(trim(p_nome), ''), 80);
begin
  if p_codigo !~ '^[A-Z0-9]{4,8}$' then raise exception 'codigo invalido'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 30 then raise exception 'itens invalidos'; end if;
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_q := (v_item ->> 'qtd')::int;
    select * into s from sabores where id = v_item ->> 'id';
    if s.id is null or v_q is null or v_q <= 0 or v_q > 5000 then raise exception 'item invalido'; end if;
    if not s.disponivel or not s.ativo then v_alertas := v_alertas || (s.nome || ' estava esgotado'); end if;
    v_total := v_total + v_q;
    v_itens := v_itens || jsonb_build_object('id', s.id, 'nome', s.nome, 'qtd', v_q);
  end loop;
  if v_total < 10 then raise exception 'pedido minimo'; end if;
  select * into c from config where id = 1;
  if exists (select 1 from dias_bloqueados where data = p_data_festa) then
    v_alertas := v_alertas || 'o dia estava bloqueado'::text;
  end if;
  if c.limite_dia is not null and p_data_festa is not null then
    select coalesce(sum(total_docinhos), 0) into v_ocupado from pedidos where data_festa = p_data_festa and status <> 'cancelado';
    if v_ocupado + v_total > c.limite_dia then v_alertas := v_alertas || ('passa do limite do dia (' || v_ocupado + v_total || ' de ' || c.limite_dia || ')'); end if;
  end if;
  insert into pedidos (codigo, origem, cliente_nome, itens, total_docinhos, valor, data_festa, observacoes, anotacoes)
  values (
    p_codigo, 'site', v_nome, v_itens, v_total,
    (v_total / 100) * c.preco_cento + (v_total % 100) * c.preco_unidade,
    p_data_festa, left(nullif(trim(p_observacoes), ''), 1000),
    case when array_length(v_alertas, 1) > 0 then 'Atenção: ' || array_to_string(v_alertas, '; ') end
  )
  on conflict (codigo) do nothing;
  if found then
    perform avisar_celular('Pedido novo #' || p_codigo,
      coalesce(v_nome, 'Cliente') || ': ' || v_total || ' docinhos' ||
      coalesce(' para ' || to_char(p_data_festa, 'DD/MM'), ''));
  end if;
end;
$$;

-- 7. Dias sem vaga para o site: bloqueados à mão ou que já chegaram no limite.
create or replace function dias_lotados() returns setof date
language sql stable security definer set search_path = public as $$
  select data from dias_bloqueados where data >= current_date
  union
  select p.data_festa from pedidos p, config c
  where c.id = 1 and c.limite_dia is not null and p.data_festa >= current_date and p.status <> 'cancelado'
  group by p.data_festa, c.limite_dia
  having sum(p.total_docinhos) >= c.limite_dia;
$$;

-- 8. Página de pagamento: só valores e situação do pedido, nada de dados pessoais.
create or replace function dados_pagamento(p_codigo text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'codigo', codigo,
    'total', valor + frete,
    'sinal', round((valor + frete) * 0.5, 2),
    'sinal_pago', sinal_pago,
    'restante_pago', restante_pago,
    'cancelado', status = 'cancelado',
    'data_festa', data_festa
  )
  from pedidos where codigo = upper(p_codigo) and length(p_codigo) between 4 and 8;
$$;

revoke all on function dias_lotados() from public;
revoke all on function dados_pagamento(text) from public;
grant execute on function dias_lotados() to anon, authenticated;
grant execute on function dados_pagamento(text) to anon, authenticated;
grant execute on function criar_pedido(text, text, jsonb, date, text) to anon, authenticated;

-- 9. Fotos dos docinhos (pasta pública "fotos"; só a equipe envia e apaga)
do $$ begin
  insert into storage.buckets (id, name, public) values ('fotos', 'fotos', true) on conflict (id) do nothing;
  drop policy if exists "equipe envia fotos" on storage.objects;
  create policy "equipe envia fotos" on storage.objects for insert to authenticated with check (bucket_id = 'fotos' and eh_equipe());
  drop policy if exists "equipe troca fotos" on storage.objects;
  create policy "equipe troca fotos" on storage.objects for update to authenticated using (bucket_id = 'fotos' and eh_equipe());
  drop policy if exists "equipe apaga fotos" on storage.objects;
  create policy "equipe apaga fotos" on storage.objects for delete to authenticated using (bucket_id = 'fotos' and eh_equipe());
exception when undefined_table or invalid_schema_name then
  raise notice 'storage indisponivel neste banco';
end $$;
