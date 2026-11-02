-- Sweet Grace: atualização 4 (02/11/2026).
-- Textos do site que a confeiteira edita no painel (aba Site).
-- Chave sem linha aqui = o site mostra o texto que já está no index.html.
-- Pode rodar de novo sem perder dados.

create table if not exists textos (
  chave text primary key check (chave ~ '^[a-z_]{2,40}$'),
  valor text not null default '' check (length(valor) <= 2000),
  atualizado_em timestamptz not null default now()
);

alter table textos enable row level security;

drop policy if exists "todos leem textos" on textos;
create policy "todos leem textos" on textos for select using (true);
drop policy if exists "equipe edita textos" on textos;
create policy "equipe edita textos" on textos for all to authenticated using (eh_equipe()) with check (eh_equipe());

grant select on textos to anon, authenticated;
grant insert, update, delete on textos to authenticated;
