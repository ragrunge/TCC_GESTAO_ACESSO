/** Baixa um texto como arquivo, gerado no navegador (Blob). */
export function baixarArquivo(nome: string, conteudo: string, mime = 'application/x-ndjson') {
  const url = URL.createObjectURL(new Blob([conteudo], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Baixa um Blob recebido da API (anexo de ocorrência) com o nome dado. */
export function baixarBlob(nome: string, conteudo: Blob) {
  const url = URL.createObjectURL(conteudo);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
