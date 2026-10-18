import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from '../api';
import { AuthProvider, destinoDe, RequireRole, RequireSession, useAuth } from '../auth/AuthContext';
import { ToastProvider } from '../components/Toast';
import { Layout } from './Layout';
import { criarQueryClient } from './queryClient';
import { LoginPage } from '../features/auth/LoginPage';
import { TrocarSenhaPage } from '../features/auth/TrocarSenhaPage';
import { PainelPage } from '../features/portaria/PainelPage';
import { EntradaPage } from '../features/portaria/EntradaPage';
import { PessoasDentroPage } from '../features/portaria/PessoasDentroPage';
import { EncomendasPage } from '../features/encomendas/EncomendasPage';
import { OcorrenciasPage } from '../features/ocorrencias/OcorrenciasPage';
import { UnidadesPage } from '../features/unidades/UnidadesPage';
import { VinculosPage } from '../features/vinculos/VinculosPage';
import { CadastroPage } from '../features/cadastro/CadastroPage';
import { ImportacaoPage } from '../features/importacao/ImportacaoPage';
import { HistoricoPage } from '../features/historico/HistoricoPage';
import { RelatoriosPage } from '../features/relatorios/RelatoriosPage';
import { UsuariosPage } from '../features/usuarios/UsuariosPage';
import { FuncionariosPage } from '../features/funcionarios/FuncionariosPage';
import { CatalogoProvider } from './catalogo';

function Raiz() {
  const { usuario, pronto } = useAuth();
  if (!pronto) return null;
  return <Navigate to={usuario ? destinoDe(usuario) : '/login'} replace />;
}

export function App() {
  // Um QueryClient por montagem do App (não global de módulo): testes e HMR não herdam cache.
  const [queryClient] = useState(criarQueryClient);
  return (
    <ApiProvider>
      <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/trocar-senha" element={<TrocarSenhaPage />} />
              <Route path="/" element={<Raiz />} />
              <Route element={<RequireSession><CatalogoProvider><Layout /></CatalogoProvider></RequireSession>}>
                {/* o Layout exige apenas sessão; cada rota filtra pelo papel */}
                <Route path="/painel" element={<RequireRole rota="painel"><PainelPage /></RequireRole>} />
                <Route path="/entrada" element={<RequireRole rota="entrada"><EntradaPage /></RequireRole>} />
                <Route path="/pessoas" element={<RequireRole rota="pessoas"><PessoasDentroPage /></RequireRole>} />
                <Route path="/encomendas" element={<RequireRole rota="encomendas"><EncomendasPage /></RequireRole>} />
                <Route path="/ocorrencias" element={<RequireRole rota="ocorrencias"><OcorrenciasPage /></RequireRole>} />
                <Route path="/unidades/:id?" element={<RequireRole rota="unidades"><UnidadesPage /></RequireRole>} />
                <Route path="/vinculos" element={<RequireRole rota="vinculos"><VinculosPage /></RequireRole>} />
                <Route path="/cadastro" element={<RequireRole rota="cadastro"><CadastroPage /></RequireRole>} />
                <Route path="/importar" element={<RequireRole rota="importar"><ImportacaoPage /></RequireRole>} />
                <Route path="/historico" element={<RequireRole rota="historico"><HistoricoPage /></RequireRole>} />
                <Route path="/relatorios" element={<RequireRole rota="relatorios"><RelatoriosPage /></RequireRole>} />
                <Route path="/usuarios" element={<RequireRole rota="usuarios"><UsuariosPage /></RequireRole>} />
                <Route path="/funcionarios" element={<RequireRole rota="funcionarios"><FuncionariosPage /></RequireRole>} />
              </Route>
              <Route path="*" element={<Raiz />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
      </QueryClientProvider>
    </ApiProvider>
  );
}
