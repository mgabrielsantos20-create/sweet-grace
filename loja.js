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
      return fetch(cfg.url + "/rest/v1/rpc/criar_pedido", {
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
      if (s.foto_url) { const img = card.querySelector("img"); img.src = s.foto_url; img.removeAttribute("style"); }
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
    });
    atualizar();
  }).catch(() => {});

  // Mercado Pago ligado na conta da dona? Só então o site mostra o botão.
  const MP_URL = cfg.url + "/functions/v1/mercadopago";
  fetch(MP_URL, { headers: cabecalhos }).then(r => r.ok ? r.json() : null).then(d => { window.MP_ATIVO = Boolean(d && d.ativo); }).catch(() => {});
  // Cria o checkout do Mercado Pago e leva a cliente para lá. Guarda a mensagem do pedido
  // para a página de volta (pagar.html) mandar no WhatsApp com o pagamento aprovado.
  // Cria o checkout do sinal no Mercado Pago e leva a cliente para lá. O resumo do pedido
  // fica guardado para a tela de volta (pagar.html) montar a mensagem do WhatsApp.
  window.pagarMercadoPago = async function (codigo, pedido) {
    try { if (pedido) sessionStorage.setItem("sg-pedido-" + codigo, JSON.stringify(pedido)); } catch {}
    const r = await fetch(MP_URL, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, cabecalhos), body: JSON.stringify({ codigo, tipo: "sinal" }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.url) throw new Error(d.erro || "mercado pago");
    location.href = d.url;
  };

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

  // Textos editados no painel (aba Editar site). Texto vazio mantém o original,
  // menos o recado do topo, que some quando fica vazio.
  const escapar = (t) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const comDestaque = (t) => escapar(t).replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  ler("textos?select=chave,valor").then(lista => {
    lista.forEach(({ chave, valor }) => {
      const t = (valor || "").trim();
      document.querySelectorAll('[data-texto="' + chave + '"]').forEach(alvo => {
        if (chave === "recado") { alvo.textContent = t; alvo.hidden = !t; return; }
        if (!t) return;
        if (alvo.dataset.tipo === "paragrafos") alvo.innerHTML = t.split(/\n\s*\n/).map(p => "<p>" + comDestaque(p.trim()).replace(/\n/g, "<br>") + "</p>").join("");
        else alvo.innerHTML = comDestaque(t);
      });
    });
  }).catch(() => {});

  // Pagamento na hora: depois de montar o pedido, cobra o sinal de 50% antes do WhatsApp.
  // Com o Mercado Pago ligado, a cliente paga lá (Pix ou cartão) e volta para pagar.html,
  // que manda o pedido no WhatsApp. Sem ele, mostra o QR Code do Pix da dona.
  window.abrirPagamento = function ({ msg, codigo, valor, pedido, salvamento }) {
    const temMp = Boolean(window.MP_ATIVO);
    const temPix = !temMp && Boolean(window.PIX_CONFIG && window.PixBR && typeof qrcode !== "undefined");
    if (!valor || (!temPix && !temMp)) return false;
    let dlg = document.getElementById("dlg-pix");
    if (!dlg) {
      const css = document.createElement("style");
      css.textContent = `
        #dlg-pix { border: 0; padding: 0; border-radius: 22px; width: min(440px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); background: var(--papel); color: var(--cacau); box-shadow: 0 24px 70px rgba(75,53,38,.35); }
        #dlg-pix::backdrop { background: rgba(75,53,38,.4); }
        #dlg-pix [hidden] { display: none !important; }
        #dlg-pix .pix-corpo { padding: 22px 20px 20px; display: grid; gap: 14px; text-align: center; }
        #dlg-pix h3 { font-size: 30px; }
        #dlg-pix .pix-sub { font-size: 15px; color: var(--cacau-suave); }
        #dlg-pix .pix-conta { display: grid; gap: 6px; text-align: left; font-size: 15px; background: var(--creme); border-radius: 14px; padding: 14px 16px; }
        #dlg-pix .pix-conta div { display: flex; justify-content: space-between; gap: 10px; }
        #dlg-pix .pix-conta .agora { font-weight: 500; color: var(--cacau); font-size: 17px; border-top: 1px dashed var(--linha); padding-top: 8px; margin-top: 2px; }
        #dlg-pix .pix-conta span { color: var(--cacau-suave); }
        #dlg-pix .pix-qr { width: min(230px, 70vw); margin: 0 auto; background: #fff; border-radius: 12px; padding: 4px; }
        #dlg-pix .pix-qr svg { display: block; width: 100%; height: auto; }
        #dlg-pix textarea { width: 100%; height: 60px; resize: none; font: 12px/1.4 ui-monospace, monospace; padding: 8px 10px; border: 1px solid var(--linha); border-radius: 10px; background: #fff; color: var(--cacau); }
        #dlg-pix .pix-acoes { display: grid; gap: 8px; }
        #dlg-pix .mp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; border: 0; border-radius: 999px; padding: 16px 20px; background: #009EE3; color: #fff; font: 500 16px/1.2 var(--texto); cursor: pointer; }
        #dlg-pix .mp-btn:hover { background: #007EB5; }
        #dlg-pix .mp-btn:disabled { opacity: .7; cursor: wait; }
        #dlg-pix .pix-erro { color: #A4453A; font-size: 14px; }
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
          <p class="pix-sub" id="pix-sub"></p>
          <div class="pix-conta">
            <div><span>Total do pedido</span><b id="pix-total"></b></div>
            <div><span>Na entrega</span><b id="pix-resto"></b></div>
            <div class="agora"><span>Sinal agora (50%)</span><b id="pix-sinal"></b></div>
          </div>
          <div class="pix-acoes" id="mp-area">
            <button class="mp-btn" type="button" id="mp-pagar">Pagar o sinal</button>
            <p class="pix-sub" style="font-size:13px">Pix, cartão de crédito ou débito, pelo Mercado Pago. Depois do pagamento, você volta para cá e envia o pedido no WhatsApp.</p>
            <p class="pix-erro" id="mp-erro" role="alert" hidden></p>
          </div>
          <div class="pix-acoes" id="pix-area">
            <div class="pix-qr" id="pix-qr" role="img" aria-label="QR Code do Pix"></div>
            <textarea id="pix-copia" readonly aria-label="Pix copia e cola"></textarea>
            <button class="btn contorno" type="button" id="pix-copiar">Copiar código Pix</button>
            <button class="btn" type="button" id="pix-enviar">Já paguei, enviar pelo WhatsApp</button>
          </div>
          <button class="pix-link" type="button" id="pix-depois" hidden>Combinar o pagamento pelo WhatsApp</button>
          <p class="pix-sub" style="font-size:13px">Se tiver entrega, o frete é combinado no WhatsApp.</p>
        </div>`;
      document.body.appendChild(dlg);
      dlg.querySelector(".pix-fechar").addEventListener("click", () => dlg.close());
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    }
    const $d = (id) => dlg.querySelector("#" + id);
    const brlPix = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const sinal = Math.round(valor * 50) / 100, resto = Math.round((valor - sinal) * 100) / 100;
    $d("pix-total").textContent = brlPix(valor);
    $d("pix-resto").textContent = brlPix(resto);
    $d("pix-sinal").textContent = brlPix(sinal);
    $d("mp-area").hidden = !temMp;
    $d("pix-area").hidden = !temPix;
    $d("pix-depois").hidden = true;
    $d("mp-erro").hidden = true;
    $d("pix-sub").textContent = temMp
      ? "Pague 50% agora para garantir a data. O restante você paga na entrega."
      : "Pague 50% pelo Pix para garantir a data e depois envie o pedido com o comprovante no WhatsApp.";
    const irZap = (texto) => {
      const a = document.createElement("a");
      a.href = zapLink(texto); a.target = "_blank"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      dlg.close();
    };
    $d("pix-depois").onclick = () => irZap(msg);
    if (temPix) {
      const codigoPix = PixBR.copiaECola(Object.assign({ valor: sinal, txid: codigo }, window.PIX_CONFIG));
      $d("pix-qr").innerHTML = PixBR.qrSvg(codigoPix);
      $d("pix-copia").value = codigoPix;
      $d("pix-copiar").onclick = async () => {
        try { await navigator.clipboard.writeText($d("pix-copia").value); } catch { $d("pix-copia").select(); document.execCommand("copy"); }
        $d("pix-copiar").textContent = "Código copiado!";
        setTimeout(() => $d("pix-copiar").textContent = "Copiar código Pix", 2500);
      };
      $d("pix-enviar").onclick = () => {
        if (typeof medir === "function") medir("pix_pago", { tipo: "sinal" });
        irZap(msg + "\n✅ Sinal de 50% pago pelo Pix: " + brlPix(sinal) + "\n⏳ Restante na entrega: " + brlPix(resto) + "\nSegue o comprovante do pagamento 👇");
      };
    }
    const mpBtn = $d("mp-pagar");
    mpBtn.disabled = false; mpBtn.textContent = "Pagar o sinal de " + brlPix(sinal);
    mpBtn.onclick = async () => {
      mpBtn.disabled = true; mpBtn.textContent = "Abrindo o pagamento...";
      if (typeof medir === "function") medir("mercadopago", { tipo: "sinal" });
      try {
        if (salvamento) await salvamento;
        await window.pagarMercadoPago(codigo, pedido);
      } catch (e) {
        mpBtn.disabled = false; mpBtn.textContent = "Pagar o sinal de " + brlPix(sinal);
        $d("mp-erro").textContent = "Não foi possível abrir o pagamento agora. Tente de novo ou combine pelo WhatsApp.";
        $d("mp-erro").hidden = false;
        $d("pix-depois").hidden = false;
      }
    };
    dlg.showModal();
    return true;
  };
})();
