// Sweet Grace: pagamento pelo Mercado Pago (Pix e cartão) direto do site.
//
// GET                         -> { ativo }   o site só mostra o botão quando a conta está ligada
// POST { codigo, tipo }       -> { url }     cria o checkout do pedido (tipo: "sinal" ou "total")
// POST ?aviso=1               -> aviso do Mercado Pago; marca o pedido como pago
//
// O valor sempre sai do banco, nunca do navegador. O aviso não confia no que chega:
// busca o pagamento de novo no Mercado Pago com o token antes de marcar como pago.
// Segredo necessário: MP_ACCESS_TOKEN (Access Token de produção da conta da dona).

const SITE = "https://mgabrielsantos20-create.github.io/sweet-grace/";
const MP = "https://api.mercadopago.com";
const URL_BANCO = Deno.env.get("SUPABASE_URL")!;
const CHAVE_BANCO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("MP_ACCESS_TOKEN") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (dados: unknown, status = 200) =>
  new Response(JSON.stringify(dados), { status, headers: { ...cors, "Content-Type": "application/json" } });

const banco = (caminho: string, init: RequestInit = {}) =>
  fetch(URL_BANCO + "/rest/v1/" + caminho, {
    ...init,
    headers: { apikey: CHAVE_BANCO, Authorization: "Bearer " + CHAVE_BANCO, "Content-Type": "application/json", ...(init.headers || {}) },
  });

type Pedido = {
  id: string; codigo: string; cliente_nome: string | null; status: string; valor: number; frete: number;
  sinal_pago: boolean; restante_pago: boolean; anotacoes: string | null; total_docinhos: number;
};

async function lerPedido(codigo: string): Promise<Pedido | null> {
  const r = await banco("pedidos?select=id,codigo,cliente_nome,status,valor,frete,sinal_pago,restante_pago,anotacoes,total_docinhos&codigo=eq." + encodeURIComponent(codigo));
  if (!r.ok) throw new Error("banco " + r.status);
  return (await r.json())[0] || null;
}

const centavos = (v: number) => Math.round(v * 100) / 100;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// O que falta pagar neste pedido. Com o sinal já pago, só sobra o restante.
function cobranca(p: Pedido, tipo: string) {
  const total = centavos(Number(p.valor || 0) + Number(p.frete || 0));
  const sinal = centavos(total / 2);
  if (p.sinal_pago) return { tipo: "restante", valor: centavos(total - sinal), rotulo: "restante" };
  if (tipo === "total") return { tipo: "total", valor: total, rotulo: "valor total" };
  return { tipo: "sinal", valor: sinal, rotulo: "sinal de 50%" };
}

async function criarCheckout(req: Request) {
  const corpo = await req.json().catch(() => ({}));
  const codigo = String(corpo.codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (!codigo) return json({ erro: "codigo" }, 400);
  // O site grava o pedido logo antes de abrir o pagamento: espera um pouco se ainda não chegou.
  let p = await lerPedido(codigo);
  for (let i = 0; !p && i < 3; i++) { await new Promise(r => setTimeout(r, 1200)); p = await lerPedido(codigo); }
  if (!p) return json({ erro: "pedido nao encontrado" }, 404);
  if (p.status === "cancelado") return json({ erro: "pedido cancelado" }, 409);
  if (p.restante_pago) return json({ erro: "pedido ja pago" }, 409);
  const c = cobranca(p, String(corpo.tipo || "sinal"));
  if (!(c.valor > 0)) return json({ erro: "sem valor" }, 409);

  const volta = SITE + "pagar.html?pedido=" + codigo + "&mp=";
  const r = await fetch(MP + "/checkout/preferences", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json", "X-Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      items: [{
        id: codigo,
        title: "Sweet Grace · Pedido #" + codigo + " (" + c.rotulo + ")",
        description: p.total_docinhos + " docinhos",
        quantity: 1,
        currency_id: "BRL",
        unit_price: c.valor,
      }],
      external_reference: codigo + ":" + c.tipo,
      statement_descriptor: "SWEETGRACE",
      back_urls: { success: volta + "ok", pending: volta + "pendente", failure: volta + "falhou" },
      auto_return: "approved",
      notification_url: URL_BANCO + "/functions/v1/mercadopago?aviso=1",
    }),
  });
  if (!r.ok) { console.error("preferencia", r.status, await r.text()); return json({ erro: "mercado pago" }, 502); }
  const pref = await r.json();
  return json({ url: pref.init_point, valor: c.valor, tipo: c.tipo });
}

async function receberAviso(req: Request) {
  const u = new URL(req.url);
  const corpo = await req.json().catch(() => ({}));
  const tipo = corpo.type || corpo.topic || u.searchParams.get("type") || u.searchParams.get("topic");
  const id = String(corpo?.data?.id || u.searchParams.get("data.id") || u.searchParams.get("id") || "");
  // Só interessa aviso de pagamento. Os outros recebem 200 para o Mercado Pago não repetir.
  if (tipo !== "payment" || !/^\d+$/.test(id)) return json({ ok: true });

  const r = await fetch(MP + "/v1/payments/" + id, { headers: { Authorization: "Bearer " + TOKEN } });
  if (!r.ok) { console.error("pagamento", id, r.status); return json({ erro: "consulta" }, 502); }
  const pg = await r.json();
  if (pg.status !== "approved") return json({ ok: true, status: pg.status });

  const [codigo, tipoPago] = String(pg.external_reference || "").split(":");
  const p = codigo && await lerPedido(codigo);
  if (!p) return json({ ok: true, aviso: "pedido nao encontrado" });
  if ((p.anotacoes || "").includes("pagamento " + id)) return json({ ok: true, repetido: true });

  const valor = Number(pg.transaction_amount || 0);
  const quitou = tipoPago === "total" || tipoPago === "restante";
  const forma = pg.payment_type_id === "credit_card" ? "cartão de crédito" : pg.payment_type_id === "debit_card" ? "cartão de débito" : pg.payment_method_id === "pix" ? "Pix" : (pg.payment_method_id || "Mercado Pago");
  const nota = "Mercado Pago: " + (quitou ? (tipoPago === "total" ? "total" : "restante") : "sinal") + " de " + brl(valor) + " pago no " + forma + " (pagamento " + id + ")";
  const mudar: Record<string, unknown> = {
    sinal_pago: true,
    anotacoes: (p.anotacoes ? p.anotacoes + "\n" : "") + nota,
  };
  if (quitou) mudar.restante_pago = true;
  if (["novo", "aguardando_sinal"].includes(p.status)) mudar.status = "confirmado";
  const w = await banco("pedidos?id=eq." + p.id, { method: "PATCH", body: JSON.stringify(mudar) });
  if (!w.ok) { console.error("gravar", w.status, await w.text()); return json({ erro: "gravar" }, 500); }

  // Aviso no celular da dona (o mesmo do pedido novo), se estiver ligado.
  try {
    const [a] = await (await banco("avisos?select=ntfy_topico,ligado&id=eq.1")).json();
    if (a?.ligado && a.ntfy_topico) {
      await fetch("https://ntfy.sh", {
        method: "POST",
        body: JSON.stringify({ topic: a.ntfy_topico, title: "Pagamento recebido #" + codigo, message: (p.cliente_nome || "Cliente") + " pagou " + brl(valor) + " no " + forma, tags: ["moneybag"] }),
      });
    }
  } catch (e) { console.error("aviso celular", e); }
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method === "GET") return json({ ativo: Boolean(TOKEN) });
    if (req.method !== "POST") return json({ erro: "metodo" }, 405);
    if (new URL(req.url).searchParams.has("aviso")) return await receberAviso(req);
    if (!TOKEN) return json({ erro: "mercado pago desligado" }, 503);
    return await criarCheckout(req);
  } catch (e) {
    console.error(e);
    return json({ erro: "falha" }, 500);
  }
});
