import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from './Button';

/*
 * Estados de carregamento (catálogo em prototipo: sistema/Carregamento.dc.html):
 * - Splash: só na abertura (JavaScript baixando, sessão sendo conferida). Mesmo visual do splash do index.html.
 * - Skeleton (Osso, Lista carregando): listas, tabelas e cartões esperando a API. Aparece depois de 200 ms.
 * - Spinner pequeno (CarregandoLinha, Button carregando): ação enviada, seção de uma linha, "Carregar mais".
 * Atualização em segundo plano não usa nenhum deles: os dados velhos ficam na tela.
 * Para skeleton use `isLoading` do React Query, não `isPending`: query desligada (enabled: false) fica pending para sempre.
 */

/**
 * Splash da abertura (shared/splash.html do Claude Design), com as classes do splash estático do index.html
 * (o CSS mora lá, antes do bundle). Desconta o tempo já passado desde o carregamento da página: se o splash
 * estático já estava na tela, este aparece na hora e sem redesenhar o símbolo, sem piscar na troca.
 * `abertura`: a animação da primeira abertura da aba ou da entrada depois do login (ver `Abertura`), na hora e
 * sem o aviso de demora; `redesenhar` força o arco e a pessoa a entrarem de novo (login).
 */
export function Splash({ abertura = false, redesenhar = false, saindo = false }: { abertura?: boolean; redesenhar?: boolean; saindo?: boolean }) {
  // Calculado uma vez: mudar o atraso de uma animação em andamento a faria voltar ao começo
  const [{ estilo, continua }] = useState(() => {
    const passado = typeof performance === 'undefined' ? 0 : performance.now();
    return {
      // O splash estático só aparece depois de 300 ms: antes disso, o símbolo ainda não foi desenhado
      continua: !abertura || (!redesenhar && passado >= 300),
      estilo: abertura
        ? { '--cns-atraso': '0s' } as CSSProperties
        : { '--cns-atraso': `${Math.max(0, 300 - passado)}ms`, '--cns-lento': `${Math.max(0, 8000 - passado)}ms` } as CSSProperties,
    };
  });
  return (
    <div className={`cns ${continua ? 'cns--continua' : ''} ${saindo ? 'cns-out' : ''}`} role="status" aria-live="polite" style={estilo}>
      <svg className="cns-mark" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#0B5563" />
        <path className="cns-arch" d="M9.5 24.5V15a6.5 6.5 0 0 1 13 0v9.5" fill="none" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" />
        <circle className="cns-dot" cx="16" cy="19.5" r="2.8" fill="#A9D2D8" />
      </svg>
      <div className="cns-name">Gestão de Acesso</div>
      <div className="cns-bar" aria-hidden><i /></div>
      <span className="cns-sr">Carregando o sistema de Gestão de Acesso</span>
      {!abertura && (
        <div className="cns-slow">
          <p>Está demorando mais que o normal. Verifique a conexão.</p>
          <button type="button" onClick={() => window.location.reload()}>Tentar de novo</button>
        </div>
      )}
    </div>
  );
}

/** Duração da animação de abertura, contada desde o carregamento da página. */
const DURACAO_ABERTURA_MS = 1600;
const CHAVE_ABERTURA = 'gestao-acesso.abertura-vista';

/**
 * Primeira abertura da aba (começo do turno)? Marca na sessionStorage e responde só uma vez: refresh e
 * navegação na mesma aba não repetem a animação. Sem storage (modo privado bloqueado), não mostra.
 */
// Navegador automatizado (testes e2e): sem a camada, que só atrasaria os cliques
const automatizado = () => typeof navigator !== 'undefined' && navigator.webdriver;

export function primeiraAbertura(): boolean {
  if (automatizado()) return false;
  try {
    if (sessionStorage.getItem(CHAVE_ABERTURA)) return false;
    sessionStorage.setItem(CHAVE_ABERTURA, '1');
    return true;
  } catch { return false; }
}

/**
 * Animação completa da marca por cima do sistema, na primeira abertura da aba. O sistema carrega por baixo
 * (foco e teclado já funcionam); a camada sai sozinha em ~1,6 s desde o carregamento da página (o arco se desenha e a pessoa entra).
 */
export function Abertura({ aoEntrar = false }: { aoEntrar?: boolean }) {
  const [fase, setFase] = useState<'visivel' | 'saindo' | 'fim'>('visivel');
  useEffect(() => {
    // Se a animação começa agora (login, ou o splash estático nem chegou a aparecer), ela precisa do tempo inteiro
    // (arco 0,7 s + pessoa até 1,1 s); se o splash estático já estava na tela, só o que falta até 1,6 s da página.
    const passado = typeof performance === 'undefined' ? 0 : performance.now();
    const resta = aoEntrar || passado < 300 ? DURACAO_ENTRADA_MS : Math.max(0, DURACAO_ABERTURA_MS - passado);
    const t1 = setTimeout(() => setFase('saindo'), resta);
    const t2 = setTimeout(() => setFase('fim'), resta + 200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [aoEntrar]);
  return fase === 'fim' ? null : <Splash abertura redesenhar={aoEntrar} saindo={fase === 'saindo'} />;
}

/** Animação ao entrar (depois do login): o login acontece poucas vezes por turno e marca a entrada no sistema. */
const DURACAO_ENTRADA_MS = 1300;
const EVENTO_ENTRADA = 'gestao-acesso:entrada';

/** Chamado pela tela de login quando a sessão abre. */
export function mostrarAberturaAoEntrar() {
  if (!automatizado()) window.dispatchEvent(new Event(EVENTO_ENTRADA));
}

/** Fica montado na raiz e mostra a animação a cada `mostrarAberturaAoEntrar`. */
export function AberturaAoEntrar() {
  const [vez, setVez] = useState(0);
  useEffect(() => {
    const mostrar = () => setVez((v) => v + 1);
    window.addEventListener(EVENTO_ENTRADA, mostrar);
    return () => window.removeEventListener(EVENTO_ENTRADA, mostrar);
  }, []);
  return vez === 0 ? null : <Abertura key={vez} aoEntrar />;
}

/** Bloco cinza do skeleton. Escondido do leitor de tela; quem anuncia é o contêiner. */
export function Osso({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`osso block ${className}`} />;
}

/**
 * Contêiner de skeleton fora das listas (cartões, blocos): `aria-busy`, texto só para leitor de tela com o nome do
 * conteúdo e os ossos só depois de 200 ms.
 */
export function Esqueleto({ rotulo, children, className = '' }: { rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div aria-busy="true" className={`apos-espera ${className}`}>
      <span role="status" className="sr-only">Carregando {rotulo}</span>
      {children}
    </div>
  );
}

/** Spinner pequeno com texto curto, para seção de uma linha ou corpo de modal que ainda baixa código. */
export function CarregandoLinha({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p role="status" className={`flex items-center gap-2 text-[14px] text-[#56616B] ${className}`}>
      <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden />{children}
    </p>
  );
}

/**
 * Erro de carregamento no lugar do conteúdo, com "Tentar de novo" (para não confundir falha com carregando).
 * `onTentar` é o refetch da consulta; o botão gira enquanto ela roda.
 */
export function ErroCarregar({ mensagem, onTentar, className = '' }: { mensagem: string; onTentar: () => unknown; className?: string }) {
  const [tentando, setTentando] = useState(false);
  async function tentar() {
    setTentando(true);
    try { await onTentar(); } finally { setTentando(false); }
  }
  return (
    <div role="alert" className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#FDA29B] bg-[#FEE4E2] px-4 py-3 text-[14px] text-[#912018] ${className}`}>
      <span className="flex min-w-0 items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />{mensagem}</span>
      <Button pequeno carregando={tentando} onClick={() => void tentar()}>Tentar de novo</Button>
    </div>
  );
}
