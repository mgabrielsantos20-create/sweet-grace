// Liga o site ao painel da confeiteira (Supabase).
// Sem config-supabase.js preenchido, nada aqui roda e o site funciona como antes.
(function () {
  const cfg = window.SWEET_GRACE_SUPABASE || {};
  if (!cfg.url || !cfg.chave) return;

  const cabecalhos = { apikey: cfg.chave, Authorization: "Bearer " + cfg.chave };
  const ler = (caminho) => fetch(cfg.url + "/rest/v1/" + caminho, { headers: cabecalhos }).then(r => r.ok ? r.json() : Promise.reject(r.status));

  // Grava o pedido no painel. O WhatsApp abre de qualquer jeito, mesmo se isso falhar.
  window.salvarPedido = function (pedido) {
    try {
      fetch(cfg.url + "/rest/v1/rpc/criar_pedido", {
        method: "POST",
        keepalive: true,
        headers: Object.assign({ "Content-Type": "application/json" }, cabecalhos),
        body: JSON.stringify({ p_codigo: pedido.codigo, p_nome: pedido.nome, p_itens: pedido.itens, p_data_festa: pedido.data || null, p_observacoes: pedido.obs })
      }).catch(() => {});
    } catch (e) { /* segue para o WhatsApp */ }
  };

  const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  // Sabores esgotados: selo no cardápio e fora do montador de pedido.
  ler("sabores?select=id,disponivel").then(lista => {
    lista.filter(s => !s.disponivel).forEach(s => {
      const img = document.querySelector('.doce img[src$="/' + s.id + '.jpg"], .doce img[src="assets/' + s.id + '.jpg"]');
      const card = img && img.closest(".doce");
      if (card) {
        card.classList.add("esgotado");
        const foto = card.querySelector(".doce-foto");
        foto.querySelector(".tag")?.remove();
        const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "Esgotado no momento";
        foto.prepend(tag);
      }
      const menos = document.getElementById("menos-" + s.id), mais = document.getElementById("mais-" + s.id);
      if (mais) {
        if (typeof qtd !== "undefined" && qtd[s.id]) { qtd[s.id] = 0; document.getElementById("qtd-" + s.id).textContent = "0"; atualizar(); }
        mais.disabled = menos.disabled = true;
        const linha = mais.closest(".linha");
        linha.classList.add("esgotado");
        linha.querySelector("label").textContent += " (esgotado)";
      }
    });
  }).catch(() => {});

  // Preços definidos no painel.
  ler("config?select=preco_unidade,preco_cento&id=eq.1").then(([c]) => {
    if (!c || typeof PRECOS === "undefined") return;
    const uni = Number(c.preco_unidade), cento = Number(c.preco_cento);
    if (uni === PRECOS.unidade && cento === PRECOS.cento) return;
    PRECOS.unidade = uni; PRECOS.cento = cento;
    document.querySelectorAll(".doce .preco").forEach(p => {
      p.querySelector("strong").firstChild.textContent = brl(cento) + " ";
      p.querySelector("span").textContent = brl(uni) + " a unidade";
    });
    const economia = document.querySelector(".economia");
    if (economia) {
      const cada = cento / 100, poupa = uni * 100 - cento;
      economia.innerHTML = "<strong>No cento, cada docinho sai por " + brl(cada) + ".</strong>" +
        (poupa > 0 ? " Você economiza " + brl(poupa) + " em relação ao preço da unidade." : "");
    }
    document.querySelectorAll(".kit").forEach(k => {
      const n = parseInt(k.querySelector(".kit-qtd").textContent, 10);
      if (!n) return;
      const v = brl(valor(n));
      k.querySelector(".kit-preco").textContent = v;
      const b = k.querySelector(".kit-btn");
      b.dataset.kit = b.dataset.kit.replace(/R\$\s?[\d.,]+/, v);
      b.href = zapLink("Olá, Sweet Grace! Quero o kit " + b.dataset.kit + ". Sabores: ");
    });
    atualizar();
  }).catch(() => {});

  // Dias sem vaga.
  ler("dias_bloqueados?select=data").then(lista => {
    window.DIAS_BLOQUEADOS = lista.map(d => d.data);
  }).catch(() => {});

  // Depoimentos publicados no painel.
  ler("depoimentos?select=nome,festa,texto&publicado=eq.true&order=criado_em.desc&limit=6").then(lista => {
    if (!lista.length) return;
    const alvo = document.getElementById("depo-lista");
    lista.forEach(d => {
      const f = document.createElement("figure"); f.className = "depo";
      const q = document.createElement("blockquote"); q.textContent = "“" + d.texto + "”";
      const c = document.createElement("figcaption");
      const b = document.createElement("b"); b.textContent = d.nome.split(" ")[0];
      c.append(b, d.festa ? " · " + d.festa : "");
      f.append(q, c); alvo.appendChild(f);
    });
    document.getElementById("depoimentos").hidden = false;
  }).catch(() => {});
})();
