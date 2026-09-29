// Pix "copia e cola" (BR Code do Banco Central) e QR Code, gerados no navegador.
// Usado pela página de pagamento e pelo painel. Precisa de vendor/qrcode-generator-2.0.4.js para o QR.
(function () {
  const campo = (id, valor) => id + String(valor.length).padStart(2, "0") + valor;
  const limpar = (t, max) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

  function crc16(texto) {
    let crc = 0xFFFF;
    for (let i = 0; i < texto.length; i++) {
      crc ^= texto.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }

  // chave já no formato do Pix: CPF/CNPJ só números, celular +55DDDNUMERO, e-mail ou chave aleatória.
  function copiaECola({ chave, nome, cidade, valor, txid }) {
    const conta = campo("00", "br.gov.bcb.pix") + campo("01", chave.trim());
    let p = campo("00", "01") + campo("26", conta) + campo("52", "0000") + campo("53", "986");
    if (valor > 0) p += campo("54", Number(valor).toFixed(2));
    p += campo("58", "BR") + campo("59", limpar(nome, 25) || "SWEET GRACE") + campo("60", limpar(cidade, 15) || "BELEM");
    p += campo("62", campo("05", (txid || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***"));
    p += "6304";
    return p + crc16(p);
  }

  // Deixa a chave no formato que o Pix espera, a partir do tipo escolhido.
  function normalizarChave(tipo, chave) {
    chave = (chave || "").trim();
    if (tipo === "cpf" || tipo === "cnpj") return chave.replace(/\D/g, "");
    if (tipo === "celular") { let d = chave.replace(/\D/g, ""); if (!d.startsWith("55") || d.length <= 11) d = "55" + d; return "+" + d; }
    if (tipo === "email") return chave.toLowerCase();
    return chave;
  }

  function qrSvg(texto) {
    const q = qrcode(0, "M");
    q.addData(texto);
    q.make();
    return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
  }

  window.PixBR = { copiaECola, normalizarChave, qrSvg, crc16 };
})();
