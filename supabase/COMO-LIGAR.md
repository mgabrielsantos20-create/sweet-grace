# Como ligar o painel da confeiteira

O painel fica em `painel/` (no site: **Área da confeiteira**, no rodapé).
Ele guarda os dados no Supabase, que é gratuito para o tamanho da Sweet Grace.
Enquanto não estiver ligado, o site funciona como antes e o painel mostra só a demonstração (`painel/?demo`).

## 1. Criar o projeto no Supabase
1. Entre em https://supabase.com e crie uma conta (pode ser com o GitHub).
2. **New project**: nome `sweet-grace`, região **South America (São Paulo)**. Guarde a senha do banco num lugar seguro.

## 2. Criar as tabelas
1. No menu, abra **SQL Editor** > **New query**.
2. Cole todo o arquivo `supabase/banco.sql`.
3. Na última linha, troque `email-da-confeiteira@exemplo.com` pelo e-mail da confeiteira.
4. Clique em **Run**.

## 3. Criar o login dela
1. **Authentication** > **Sign In / Providers**: desligue **Allow new users to sign up**. Assim ninguém cria conta sozinho.
2. **Authentication** > **Users** > **Add user** > **Create new user**: o mesmo e-mail do passo 2, uma senha, e marque **Auto Confirm User**.

## 4. Ligar o site
1. **Project Settings** > **API Keys** (ou **Data API**): copie a **Project URL** e a chave **anon / publishable**.
2. Cole as duas em `config-supabase.js`.
   **Nunca** use a chave `service_role` / `secret` ali: o site é público.

## Segurança, em uma frase
Visitantes só conseguem ler o cardápio, os preços, os dias bloqueados e os depoimentos publicados, e só criam pedidos e depoimentos pelas funções que conferem os dados.
Pedidos só aparecem para quem entrar com um e-mail cadastrado na tabela `equipe`.
