-- Sweet Grace: atualização 3 (29/10/2026).
-- Churros no lugar do Cajuzinho e pedido mínimo de 25 docinhos (25 de cada sabor).
-- Pode rodar de novo sem perder dados.

insert into sabores (id, nome, descricao, cor, ordem, disponivel, ativo)
values ('churros', 'Churros', 'Doce de leite com canela e açúcar, com gostinho de churros.', '#c8894a', 5, true, true)
on conflict (id) do nothing;

update sabores set ativo = false, disponivel = false where id = 'cajuzinho';

insert into receitas (sabor_id, ingrediente_id, qtd_por_100)
select 'churros', ingrediente_id, qtd_por_100 from receitas where sabor_id = 'cajuzinho'
on conflict do nothing;

-- Pedido do site: abaixo de 25 (no total ou por sabor) ainda é salvo, com alerta nas anotações.
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
    if v_q < 25 then v_alertas := v_alertas || (s.nome || ' com menos de 25'); end if;
    v_total := v_total + v_q;
    v_itens := v_itens || jsonb_build_object('id', s.id, 'nome', s.nome, 'qtd', v_q);
  end loop;
  if v_total < 10 then raise exception 'pedido minimo'; end if;
  if v_total < 25 then v_alertas := v_alertas || 'abaixo do pedido mínimo de 25'::text; end if;
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
