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

  // Sabores do painel: esgotados, escondidos, fotos, textos e sabores novos.
  const doces = document.querySelector(".doces");
  const cartaoDe = (id) => {
    const img = document.querySelector('.doce img[src="assets/' + id + '.jpg"]') || document.querySelector('.doce[data-sabor="' + id + '"] img');
    return img && img.closest(".doce");
  };
  ler("sabores?select=*&order=ordem").then(lista => {
    lista.forEach(s => {
      let card = cartaoDe(s.id);
      // Sabor criado no painel: copia um cartão do cardápio e cria a linha no montador.
      if (!card && s.ativo !== false && doces) {
        const modelo = doces.querySelector(".doce");
        card = modelo.cloneNode(true);
        card.dataset.sabor = s.id;
        card.querySelector(".tag")?.remove();
        const img = card.querySelector("img");
        img.src = s.foto_url || "assets/logo.jpeg";
        img.alt = s.nome;
        img.removeAttribute("style");
        const foto = card.querySelector(".doce-foto");
        foto.className = "doce-foto fundo-rosa";
        card.querySelector("h3").textContent = s.nome;
        card.querySelector(".doce-corpo p").textContent = s.descricao || "";
        doces.appendChild(card);
      }
      if (typeof SABORES !== "undefined" && !SABORES.some(x => x.id === s.id) && s.ativo !== false) {
        const novo = { id: s.id, nome: s.nome, cor: s.cor || "#e9b8b5" };
        SABORES.push(novo);
        adicionarSabor(novo);
      }
      if (!card) return;
      const mais = document.getElementById("mais-" + s.id), menos = document.getElementById("menos-" + s.id);
      const linha = mais && mais.closest(".linha");
      if (s.ativo === false) {
        card.style.display = "none";
        if (linha) linha.style.display = "none";
        return;
      }
      if (s.foto_url) card.querySelector("img").src = s.foto_url;
      if (s.nome) { card.querySelector("h3").textContent = s.nome; card.querySelector("img").alt = s.nome; }
      if (s.descricao) card.querySelector(".doce-corpo p").textContent = s.descricao;
      if (linha && s.nome) linha.querySelector("label").textContent = s.nome;
      const sab = typeof SABORES !== "undefined" && SABORES.find(x => x.id === s.id);
      if (sab) { sab.nome = s.nome; if (s.cor && linha) { sab.cor = s.cor; linha.querySelector(".ponto").style.background = s.cor; } }
      if (!s.disponivel) {
        card.classList.add("esgotado");
        const foto = card.querySelector(".doce-foto");
        foto.querySelector(".tag")?.remove();
        const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "Esgotado no momento";
        foto.prepend(tag);
        if (mais) {
          if (qtd[s.id]) { qtd[s.id] = 0; document.getElementById("qtd-" + s.id).textContent = "0"; atualizar(); }
          mais.disabled = menos.disabled = true;
          linha.classList.add("esgotado");
          linha.querySelector("label").textContent += " (esgotado)";
        }
      }
    });
  }).catch(() => {});

  // Preços definidos no painel.
  ler("config?select=*&id=eq.1").then(([c]) => {
    if (c && c.pix_chave) window.PIX_CONFIG = { chave: c.pix_chave, nome: c.pix_nome, cidade: c.pix_cidade };
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

  // Dias sem vaga: bloqueados no painel ou que já chegaram no limite de docinhos.
  fetch(cfg.url + "/rest/v1/rpc/dias_lotados", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, cabecalhos), body: "{}" })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(lista => { window.DIAS_BLOQUEADOS = lista.map(d => typeof d === "string" ? d : d.dias_lotados); })
    .catch(() => {});

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

  // Pagamento na hora: depois de montar o pedido, mostra o Pix do sinal (ou do total)
  // com QR Code e copia e cola, e depois leva o pedido e o comprovante para o WhatsApp.
  window.abrirPagamento = function ({ msg, codigo, valor }) {
    if (!window.PIX_CONFIG || !window.PixBR || typeof qrcode === "undefined" || !valor) return false;
    let dlg = document.getElementById("dlg-pix");
    if (!dlg) {
      const css = document.createElement("style");
      css.textContent = `
        #dlg-pix { border: 0; padding: 0; border-radius: 22px; width: min(440px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); background: var(--papel); color: var(--cacau); box-shadow: 0 24px 70px rgba(75,53,38,.35); }
        #dlg-pix::backdrop { background: rgba(75,53,38,.4); }
        #dlg-pix .pix-corpo { padding: 22px 20px 20px; display: grid; gap: 14px; text-align: center; }
        #dlg-pix h3 { font-size: 30px; }
        #dlg-pix .pix-sub { font-size: 15px; color: var(--cacau-suave); }
        #dlg-pix .pix-opcoes { display: flex; gap: 6px; justify-content: center; }
        #dlg-pix .pix-opcao { border: 1px solid var(--linha); background: var(--papel); border-radius: 999px; padding: 8px 14px; font: inherit; font-size: 14px; color: var(--cacau-suave); cursor: pointer; }
        #dlg-pix .pix-opcao[aria-pressed="true"] { border-color: var(--ouro); background: var(--creme-2); color: var(--cacau); }
        #dlg-pix .pix-valor { font: 500 40px/1 var(--display); }
        #dlg-pix .pix-qr { width: min(230px, 70vw); margin: 0 auto; background: #fff; border-radius: 12px; padding: 4px; }
        #dlg-pix .pix-qr svg { display: block; width: 100%; height: auto; }
        #dlg-pix textarea { width: 100%; height: 60px; resize: none; font: 12px/1.4 ui-monospace, monospace; padding: 8px 10px; border: 1px solid var(--linha); border-radius: 10px; background: #fff; color: var(--cacau); }
        #dlg-pix .pix-acoes { display: grid; gap: 8px; }
        #dlg-pix .pix-fechar { position: absolute; right: 10px; top: 10px; border: 0; background: none; font-size: 22px; color: var(--cacau-suave); cursor: pointer; padding: 6px 10px; }
        #dlg-pix .pix-link { background: none; border: 0; color: var(--cacau-suave); text-decoration: underline; font: inherit; font-size: 14px; cursor: pointer; }`;
      document.head.appendChild(css);
      dlg = document.createElement("dialog");
      dlg.id = "dlg-pix";
      dlg.setAttribute("aria-labelledby", "pix-titulo");
      dlg.innerHTML = `
        <button class="pix-fechar" type="button" aria-label="Fechar">✕</button>
        <div class="pix-corpo">
          <h3 id="pix-titulo">Reserve a sua data</h3>
          <p class="pix-sub">Pague o sinal pelo Pix e depois envie o pedido com o comprovante pelo WhatsApp.</p>
          <div class="pix-opcoes" role="group" aria-label="O que pagar">
            <button class="pix-opcao" type="button" data-tipo="sinal">Sinal (50%)</button>
            <button class="pix-opcao" type="button" data-tipo="total">Valor total</button>
          </div>
          <div><p class="pix-sub" id="pix-rotulo"></p><div class="pix-valor" id="pix-valor"></div></div>
          <div class="pix-qr" id="pix-qr" role="img" aria-label="QR Code do Pix"></div>
          <textarea id="pix-copia" readonly aria-label="Pix copia e cola"></textarea>
          <div class="pix-acoes">
            <button class="btn contorno" type="button" id="pix-copiar">Copiar código Pix</button>
            <button class="btn" type="button" id="pix-enviar">Já paguei, enviar comprovante</button>
            <button class="pix-link" type="button" id="pix-depois">Prefiro combinar o pagamento pelo WhatsApp</button>
          </div>
          <p class="pix-sub" style="font-size:13px">Valor dos docinhos. Se tiver entrega, o frete é combinado no WhatsApp.</p>
        </div>`;
      document.body.appendChild(dlg);
      dlg.querySelector(".pix-fechar").addEventListener("click", () => dlg.close());
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    }
    const $d = (id) => dlg.querySelector("#" + id);
    const brlPix = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const sinal = Math.round(valor * 50) / 100;
    const opcoes = { sinal: { valor: sinal, rotulo: "Sinal de 50% para reservar a data" }, total: { valor, rotulo: "Valor total dos docinhos" } };
    let escolhido = "sinal";
    const mostrar = (tipo) => {
      escolhido = tipo;
      const o = opcoes[tipo];
      const codigoPix = PixBR.copiaECola(Object.assign({ valor: o.valor, txid: codigo }, window.PIX_CONFIG));
      $d("pix-rotulo").textContent = o.rotulo;
      $d("pix-valor").textContent = brlPix(o.valor);
      $d("pix-qr").innerHTML = PixBR.qrSvg(codigoPix);
      $d("pix-copia").value = codigoPix;
      dlg.querySelectorAll(".pix-opcao").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tipo === tipo)));
    };
    const irZap = (texto) => {
      const a = document.createElement("a");
      a.href = zapLink(texto); a.target = "_blank"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      dlg.close();
    };
    dlg.querySelectorAll(".pix-opcao").forEach(b => b.onclick = () => mostrar(b.dataset.tipo));
    $d("pix-copiar").onclick = async () => {
      try { await navigator.clipboard.writeText($d("pix-copia").value); } catch { $d("pix-copia").select(); document.execCommand("copy"); }
      $d("pix-copiar").textContent = "Código copiado!";
      setTimeout(() => $d("pix-copiar").textContent = "Copiar código Pix", 2500);
    };
    $d("pix-enviar").onclick = () => {
      if (typeof medir === "function") medir("pix_pago", { tipo: escolhido });
      irZap(msg + "\nPaguei " + (escolhido === "sinal" ? "o sinal" : "o total") + " de " + brlPix(opcoes[escolhido].valor) + " pelo Pix. Vou mandar o comprovante aqui.");
    };
    $d("pix-depois").onclick = () => irZap(msg);
    mostrar("sinal");
    dlg.showModal();
    return true;
  };
})();
