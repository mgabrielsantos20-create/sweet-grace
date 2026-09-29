# Sweet Grace

Landing page da Sweet Grace, doceria artesanal. Site estático: `index.html` e as imagens em `assets/`.

Para trocar o número do WhatsApp, edite a constante `WHATSAPP` no fim do `index.html`.

## Painel da confeiteira

- `painel/`: área privada (pedidos, agenda, pagamentos, cardápio, resumo, depoimentos). Demonstração em `painel/?demo`.
- `depoimento.html`: formulário para clientes enviarem depoimentos.
- `pagar.html?pedido=CODIGO`: página de pagamento Pix (QR Code e copia e cola, gerados por `pix.js`).
- `loja.js` + `config-supabase.js`: ligam o site ao banco. Sem configuração, o site funciona como antes.
- `supabase/`: banco (`banco.sql`, depois `atualizacao-2.sql`) e o passo a passo para ligar (`COMO-LIGAR.md`).
