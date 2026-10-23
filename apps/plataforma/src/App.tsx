import { useMemo } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/cliente';
import { criarApi, type ApiPlataforma } from './api/plataforma';
import { SessaoProvider, useSessao } from './sessao/SessaoMaster';
import { Licencas } from './telas/Licencas';
import { Login } from './telas/Login';
import { NovoCondominio } from './telas/NovoCondominio';
import { TrocarSenha } from './telas/TrocarSenha';
import { Button } from './ui/ui';

export function novoQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // 4xx não se repete (credencial, permissão, validação); rede/5xx uma vez.
      queries: { retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 1, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

function Cabecalho() {
  const { estado, sair } = useSessao();
  if (estado.fase !== 'logado') return null;
  return (
    <header className="sobre-escuro flex flex-wrap items-center justify-between gap-3 bg-sidebar px-4 py-3 text-sidebar-texto sm:px-8">
      <Link to="/" className="text-[16px] font-semibold text-white no-underline">Portaria Parque · Plataforma</Link>
      <div className="flex items-center gap-3">
        <span className="text-[14px]"><span className="text-white">{estado.usuario.nome}</span> · {estado.usuario.email}</span>
        <Button variante="secundario" onClick={() => void sair()}>Sair</Button>
      </div>
    </header>
  );
}

function Rotas() {
  const { estado } = useSessao();
  if (estado.fase === 'carregando') return <p role="status" className="p-8">Carregando…</p>;
  if (estado.fase === 'deslogado') return <Login aviso={estado.aviso} />;
  if (estado.usuario.deveTrocarSenha) return <TrocarSenha />;
  return (
    <>
      <Cabecalho />
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-8">
        <Routes>
          <Route path="/" element={<Licencas />} />
          <Route path="/novo" element={<NovoCondominio />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

export function App({ api, queryClient }: { api?: ApiPlataforma; queryClient?: QueryClient }) {
  const a = useMemo(() => api ?? criarApi(), [api]);
  const qc = useMemo(() => queryClient ?? novoQueryClient(), [queryClient]);
  return (
    <QueryClientProvider client={qc}>
      <SessaoProvider api={a}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Rotas />
        </BrowserRouter>
      </SessaoProvider>
    </QueryClientProvider>
  );
}
