import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Abertura, AberturaAoEntrar, primeiraAbertura } from './components/Carregando';
import { App } from './app/App';

// Lido uma vez, fora do render: o StrictMode renderiza duas vezes e a segunda leitura diria "já visto"
const comAbertura = primeiraAbertura();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {comAbertura && <Abertura />}
    <AberturaAoEntrar />
  </StrictMode>,
);
