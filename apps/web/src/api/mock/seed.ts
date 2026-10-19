// Dados simulados. Reaproveitam os seeds do protótipo aprovado (Portaria.dc.html), com as correções do arquivo 04:
//  - unidades da estrutura configurada (ESTRUTURA_PADRAO de @portaria/domain/units: 9 blocos, A a I, 162 unidades);
//  - diaristas como Prestador; funcionário do condomínio Válter Souza (zelador) entrando por Escala;
//  - vínculos sempre solicitados pela administração (RN-03); saída como novo evento (RN-04).
// Unidades do protótipo (torres numéricas) -> blocos: torre N vira a N-ésima letra (T4-32 -> D-32); números que não
// existem na estrutura foram remapeados (tabela em apps/web/README.md, "Remapeamento de unidades").
// Alinhado ao schema (v3): unidade, área comum e ponto de acesso têm id uuid (determinístico, ver seedUtil); as
// entidades guardam ids de usuário, não nomes; telefone só com dígitos; documentoBusca = HMAC-SHA256 do CPF.
import type {
  AreaComum, AutorizacaoPrevia, CategoriaPessoa, ConferenciaComprovante, Encomenda, EventoAcesso, Funcionario,
  MeioAutorizacao, Ocorrencia, Papel, Pessoa, PontoAcesso, Restricao, StatusVinculo, TipoEvento, TipoVinculo, Unidade,
  UsuarioSistema, VinculoUnidade, Veiculo,
} from '@portaria/domain/types';
import { FORMATO_HASH, calcularHash, hashGenese } from '@portaria/domain/hashChain';
import { CHAVE_HMAC_DEMO, documentoBuscaCpf } from '@portaria/domain/cpf';
import { DIA, HORA, brt, inicioDoDia, partes } from '@portaria/domain/time';
import { AREAS_COMUNS_INICIAIS, PORTARIA_SOCIAL, codigoUnidade, gerarUnidades } from '@portaria/domain/units';
import { VERSAO_DB, type DbData } from './dbTypes';
import {
  ID_PORTARIA_SOCIAL, MARCAS, PRIMEIROS, SOBRENOMES, docMascarado, dt, gerarCpf, gerarTelefone, idAreaComumSeed, idUnidadeSeed, prng, slug,
} from './seedUtil';

const PRAZO_LEGADO = dt('31/03/2027');
const ID_JOAO = 'u1', ID_SERGIO = 'u2', ID_MARINA = 'u3', ID_PAULA = 'u4';

interface Rascunho {
  id: string; tipo: TipoEvento; pessoaId: string; categoria: CategoriaPessoa; unidadeId: string | null;
  meio: MeioAutorizacao | null; autPessoaId: string | null; apId: string | null;
  just: string | null; restricaoId: string | null; opId: string; ocorrido: number; registrado: number;
  retro: boolean; refere: string | null; obs: string | null; formulario?: string | null;
}

export async function criarSeed(): Promise<DbData> {
  const rand = prng(20261009);
  const unidades: Unidade[] = gerarUnidades().map((u) => ({ id: idUnidadeSeed(u.bloco, u.numero), bloco: u.bloco, numero: u.numero, ativo: true }));
  /** Código "D-32" -> id da unidade (o seed é escrito com os códigos do protótipo, já em blocos). */
  const U = (codigo: string) => {
    const u = unidades.find((x) => codigoUnidade(x) === codigo);
    if (!u) throw new Error(`unidade do seed não encontrada: ${codigo}`);
    return u.id;
  };
  const areasComuns: AreaComum[] = AREAS_COMUNS_INICIAIS.map((nome, i) => ({ id: idAreaComumSeed(i + 1), nome, ativo: true }));
  const pontosAcesso: PontoAcesso[] = [{ id: ID_PORTARIA_SOCIAL, nome: PORTARIA_SOCIAL, ativo: true }];
  const pessoas: Pessoa[] = [];
  const funcionarios: Funcionario[] = [];
  const vinculos: VinculoUnidade[] = [];
  const veiculos: Veiculo[] = [];
  const autorizacoes: AutorizacaoPrevia[] = [];
  const restricoes: Restricao[] = [];
  const rascunhos: Rascunho[] = [];
  const criado = dt('01/09/2026');
  const nomesUsados = new Set<string>();

  // ----- Pessoas ------------------------------------------------------------------------------
  const porNome = new Map<string, Pessoa>();
  // CPFs e telefones saem de PRNGs próprios para não alterar a sequência dos nomes/eventos gerados.
  const randCpf = prng(20261010);
  const cpfs = new Map<string, string>(); // pessoaId -> 11 dígitos (só para calcular documentoBusca; não é guardado)
  const cpfsUsados = new Set<string>();
  function pessoa(nome: string, categoria: CategoriaPessoa, x: Partial<Pessoa> = {}): Pessoa {
    let id = `pe-${slug(nome)}`;
    if (pessoas.some((p) => p.id === id)) id += `-${pessoas.length}`;
    const mascara = x.documentoMascarado ?? docMascarado(rand);
    const meio = mascara.replace(/\D/g, '');
    let cpf = gerarCpf(randCpf, meio);
    while (cpfsUsados.has(cpf)) cpf = gerarCpf(randCpf, meio);
    cpfs.set(id, cpf); cpfsUsados.add(cpf);
    const p: Pessoa = {
      id, nome, categoria, documentoTipo: 'cpf', criadoEm: criado, telefone: gerarTelefone(randCpf), ...x,
      documentoMascarado: `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`,
    };
    pessoas.push(p);
    porNome.set(nome, p);
    nomesUsados.add(nome);
    return p;
  }
  const P = (nome: string) => {
    const p = porNome.get(nome);
    if (!p) throw new Error(`pessoa do seed não encontrada: ${nome}`);
    return p;
  };

  // Vínculos
  let nVinc = 0;
  // RF-05: todo vínculo que passou por aprovação tem a conferência do comprovante (tipo, data, quem conferiu). Sem arquivo.
  const conferenciaSeed = (tipo: TipoVinculo, quando: number): ConferenciaComprovante => (
    tipo === 'proprietario' ? { tipoDocumento: 'escritura', data: inicioDoDia(quando), conferidoPorId: ID_PAULA }
    : tipo === 'inquilino' ? { tipoDocumento: 'contrato_locacao', data: inicioDoDia(quando), conferidoPorId: ID_PAULA }
    : { tipoDocumento: 'outro', descricao: 'Certidão de nascimento', data: inicioDoDia(quando), conferidoPorId: ID_PAULA });
  function vinculo(nome: string, codigo: string, tipo: TipoVinculo, status: StatusVinculo, x: Partial<VinculoUnidade> = {}, xp: Partial<Pessoa> = {}): VinculoUnidade {
    // Categoria só vira 'morador' na aprovação do vínculo: quem só tem pedido pendente segue visitante.
    const p = porNome.get(nome) ?? pessoa(nome, status === 'pendente' ? 'visitante' : 'morador', xp);
    const v: VinculoUnidade = {
      id: x.id ?? `V${100 + ++nVinc}`, pessoaId: p.id, unidadeId: U(codigo), tipo, status,
      vigenciaInicio: x.vigenciaInicio ?? null, vigenciaFim: x.vigenciaFim ?? null,
      prazoRegularizacao: status === 'legado' ? PRAZO_LEGADO : null,
      conferencia: null, solicitadoPor: 'Importação da planilha (09/09/2026)', solicitadoEm: dt('09/09/2026 10:00'),
      registradoPorId: ID_PAULA, encerradoEm: null,
      ...x,
    };
    if (status === 'aprovado' && !v.decididoPorId) { v.decididoPorId = ID_PAULA; v.decididoEm = dt('10/09/2026 09:30'); }
    // Encerrado com decisão = passou por aprovado, que exige conferência (CHECK vinculo_aprovado_conferido_ck)
    if ((status === 'aprovado' || (status === 'encerrado' && v.decididoEm)) && !v.conferencia) v.conferencia = conferenciaSeed(tipo, v.decididoEm!);
    vinculos.push(v);
    return v;
  }

  // Moradores e pedidos de vínculo do protótipo (unidades remapeadas)
  vinculo('Ana Ribeiro', 'D-32', 'proprietario', 'aprovado');
  vinculo('Paulo Ribeiro', 'D-32', 'dependente', 'aprovado');
  vinculo('Lúcia Ribeiro', 'D-32', 'dependente', 'legado');
  vinculo('Carla Mendes', 'G-11', 'inquilino', 'aprovado', { vigenciaFim: dt('31/07/2027') });
  vinculo('Helena Duarte', 'B-24', 'proprietario', 'aprovado');
  vinculo('Otávio Duarte', 'B-24', 'dependente', 'legado');
  vinculo('Marta Siqueira', 'I-13', 'proprietario', 'aprovado');
  vinculo('Sílvia Prado', 'F-04', 'proprietario', 'aprovado');
  vinculo('Hugo Prado', 'F-04', 'dependente', 'aprovado');
  vinculo('Patrícia Ramos', 'C-14', 'proprietario', 'aprovado');
  vinculo('Sandra Ferraz Teles', 'C-42', 'proprietario', 'legado');
  vinculo('Hélio Prates', 'E-03', 'proprietario', 'encerrado', {
    vigenciaFim: dt('15/09/2026'), decididoPorId: ID_PAULA, decididoEm: dt('10/09/2026 09:30'), encerradoEm: dt('15/09/2026 09:00'),
    justificativa: 'Venda do imóvel registrada em matrícula.',
  });
  // Autorizadores citados nos eventos do protótipo
  vinculo('Ricardo Gomes', 'A-33', 'proprietario', 'aprovado');
  vinculo('Teresa Almeida', 'H-42', 'proprietario', 'aprovado');
  vinculo('Cecília Batista', 'B-41', 'proprietario', 'aprovado');
  vinculo('Mônica Vieira', 'C-03', 'proprietario', 'aprovado');
  vinculo('Renato Farias', 'A-12', 'proprietario', 'aprovado');
  vinculo('Gustavo Lins', 'F-22', 'proprietario', 'aprovado');
  vinculo('Rita Sampaio', 'E-43', 'proprietario', 'aprovado');

  const T = (hhmm: string, dia = '09/10/2026') => dt(`${dia} ${hhmm}`);

  // Pedidos de vínculo pendentes (V1–V4). RN-03: sempre criados pela administração. Sem conferência registrada:
  // a administração confere o comprovante (recebido por e-mail) e registra na tela de Vínculos antes de aprovar (RF-05).
  vinculo('Rodrigo Alves', 'I-13', 'inquilino', 'pendente', {
    id: 'V1', vigenciaInicio: dt('01/10/2026'), vigenciaFim: dt('30/09/2027'), solicitadoEm: dt('01/10/2026 18:40'),
    solicitadoPor: 'Paula Nogueira (Administração), a partir de documento entregue na administração em 01/10',
    nota: 'Relacionado à ocorrência OC-2026-044: o solicitante pediu cópia das chaves na portaria em 01/10 e foi orientado a procurar a administração.',
  });
  vinculo('Rafael Mendes', 'G-11', 'dependente', 'pendente', {
    id: 'V2', vigenciaInicio: dt('06/10/2026'), solicitadoEm: dt('06/10/2026 10:05'),
    solicitadoPor: 'Paula Nogueira (Administração), a pedido de Carla Mendes (inquilina, G-11)',
  });
  vinculo('Beatriz Okada', 'E-03', 'proprietario', 'pendente', {
    id: 'V3', vigenciaInicio: dt('15/09/2026'), solicitadoEm: dt('03/10/2026 14:20'), solicitadoPor: 'Paula Nogueira (Administração)',
  });
  vinculo('Lucas Ferraz', 'C-42', 'inquilino', 'pendente', {
    id: 'V4', vigenciaInicio: dt('01/11/2026'), vigenciaFim: dt('31/10/2028'), solicitadoEm: dt('08/10/2026 09:30'),
    solicitadoPor: 'Paula Nogueira (Administração), a partir de e-mail da Imobiliária Vértice',
  });

  // Visitantes, prestadores e funcionário do condomínio
  pessoa('Marcos Pereira', 'visitante', { documentoMascarado: '***.456.789-**' });
  pessoa('Bruno Teixeira', 'visitante', { documentoMascarado: '***.218.334-**' });
  pessoa('Técnico Enel — Diego Santos', 'prestador', { empresa: 'Enel', servico: 'Manutenção de energia', documentoMascarado: '***.902.115-**' });
  pessoa('Juliana Costa', 'prestador', { empresa: 'Autônoma', servico: 'Diarista', documentoMascarado: '***.771.003-**' });
  pessoa('Cláudia Rocha', 'prestador', { empresa: 'Autônoma', servico: 'Diarista' });
  pessoa('Marcelo Antunes', 'prestador', { empresa: 'Clima Frio', servico: 'Ar-condicionado', documentoMascarado: '***.330.562-**' });
  pessoa('Márcia Pereira', 'visitante', { documentoMascarado: '***.104.887-**' });
  pessoa('Vitor Sampaio', 'visitante', { documentoMascarado: '***.640.219-**' });
  pessoa('Técnico Comgás — Leandro Prado', 'prestador', { empresa: 'Comgás', servico: 'Manutenção de gás', documentoMascarado: '***.417.330-**' });
  pessoa('Técnico Sabesp — Caio Lemos', 'prestador', { empresa: 'Sabesp', servico: 'Hidrômetro' });
  pessoa('Larissa Gomes', 'visitante');
  pessoa('Pedro Almeida', 'visitante');
  pessoa('Rogério Batista', 'prestador', { empresa: 'Batista Reformas', servico: 'Reforma' });
  pessoa('Gilberto Nascimento', 'prestador', { empresa: 'GN Obras', servico: 'Obra' });
  pessoa('Fernanda Lins', 'visitante');
  pessoa('Diego Ramos', 'visitante');
  pessoa('Thiago Moura', 'visitante');
  pessoa('Adriano Melo', 'prestador', { empresa: 'Melo Elétrica', servico: 'Elétrica' });
  pessoa('Dedetizadora Lumen — Ivo Paes', 'prestador', { empresa: 'Dedetizadora Lumen', servico: 'Dedetização' });
  pessoa('Ana Paula Reis', 'visitante');
  pessoa('Transportes Ágil — equipe de mudança', 'prestador', { empresa: 'Transportes Ágil', servico: 'Mudança' });
  pessoa('Edu Barreto', 'visitante');
  const valter = pessoa('Válter Souza', 'funcionario', { documentoMascarado: '***.512.903-**' });
  funcionarios.push({
    pessoaId: valter.id, funcao: 'Zelador', ativo: true,
    escala: { diasSemana: [1, 2, 3, 4, 5], horaInicio: '07:00', horaFim: '16:00' },
  });

  // Moradores gerados (legado, vindos da "planilha") para toda unidade sem nenhum vínculo
  let contaGer = 0;
  for (const u of unidades) {
    if (vinculos.some((v) => v.unidadeId === u.id)) continue;
    const qtd = contaGer % 3 === 0 ? 2 : 1;
    for (let k = 0; k < qtd; k++) {
      let nome = '';
      do {
        nome = `${PRIMEIROS[Math.floor(rand() * PRIMEIROS.length)]} ${SOBRENOMES[Math.floor(rand() * SOBRENOMES.length)]}`;
      } while (nomesUsados.has(nome));
      vinculo(nome, codigoUnidade(u), k === 0 ? 'proprietario' : 'dependente', 'legado');
    }
    contaGer++;
  }

  // Retenção (RNF-09): elegíveis à anonimização automática. Sem eventos, para não mexer na cadeia do protótipo.
  // - visitante cadastrado em 2023 que nunca mais voltou (mais de 3 anos sem acesso);
  // - ex-morador cujo único vínculo terminou em 31/05/2023 (mais de 3 anos).
  pessoa('Osvaldo Brandão', 'visitante', { criadoEm: dt('10/03/2023 15:20') });
  vinculo('Jurema Castilho', 'H-24', 'proprietario', 'encerrado', {
    id: 'V-JUREMA', vigenciaInicio: dt('01/02/2019'), vigenciaFim: dt('31/05/2023'), solicitadoEm: dt('01/02/2019 10:00'),
    solicitadoPor: 'Cadastro anterior ao sistema (livro da administração)', decididoPorId: ID_PAULA, decididoEm: dt('01/02/2019 10:00'),
    encerradoEm: dt('31/05/2023 18:00'), justificativa: 'Mudança registrada pela administração.',
  }, { criadoEm: dt('01/02/2019 10:00') });

  // Visitantes e prestadores recorrentes para o histórico sintético
  const reservaVisitantes: Pessoa[] = [];
  const reservaPrestadores: Pessoa[] = [];
  const servicos = [['Encanamento', 'Hidro Fácil'], ['Internet', 'NetVivo'], ['Pintura', 'Cor & Cia'], ['Limpeza', 'Brilho Limp'], ['Chaveiro', 'Chave Rápida'],
    ['Elevadores', 'ElevaTec'], ['Jardinagem', 'Verde Vida'], ['Marcenaria', 'Madeira Nobre'], ['Entrega de gás', 'GásFácil'], ['Pet shop', 'Amigo Fiel'], ['Montagem de móveis', 'Montaki'], ['Vidraçaria', 'Vidro Certo']];
  for (let i = 0; i < 45; i++) {
    let nome = '';
    do { nome = `${PRIMEIROS[Math.floor(rand() * PRIMEIROS.length)]} ${SOBRENOMES[Math.floor(rand() * SOBRENOMES.length)]}`; } while (nomesUsados.has(nome));
    reservaVisitantes.push(pessoa(nome, 'visitante'));
  }
  servicos.forEach(([serv, emp], i) => {
    const nome = `${PRIMEIROS[(i * 7 + 3) % PRIMEIROS.length]} ${SOBRENOMES[(i * 11 + 5) % SOBRENOMES.length]} (${emp})`;
    reservaPrestadores.push(pessoa(nome, 'prestador', { empresa: emp, servico: serv }));
  });

  // ----- Veículos (~175) ----------------------------------------------------------------------
  const veic = (u: string, placa: string, modelo: string, cor: string) => veiculos.push({ id: `ve-${placa.replace('-', '')}`, unidadeId: /^[A-Z0-9]{1,3}-\d+$/.test(u) ? U(u) : u, placa, modelo, cor });
  veic('D-32', 'FKR-2C41', 'Honda Fit', 'prata'); veic('D-32', 'GHT-8J20', 'VW T-Cross', 'branco');
  veic('G-11', 'EQP-4B77', 'Fiat Argo', 'cinza'); veic('B-24', 'DXA-1F03', 'Jeep Renegade', 'verde');
  veic('I-13', 'BRA-2E19', 'Toyota Corolla', 'preto'); veic('C-14', 'FJT-6H22', 'Hyundai HB20', 'branco');
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; veiculos.length < 175; i++) {
    const u = unidades[(i * 7 + 3) % unidades.length].id;
    const placa = `${letras[Math.floor(rand() * 26)]}${letras[Math.floor(rand() * 26)]}${letras[Math.floor(rand() * 26)]}-${Math.floor(rand() * 10)}${letras[Math.floor(rand() * 26)]}${Math.floor(rand() * 10)}${Math.floor(rand() * 10)}`;
    if (veiculos.some((v) => v.placa === placa)) continue;
    const [modelo, cor] = MARCAS[Math.floor(rand() * MARCAS.length)];
    veic(u, placa, modelo, cor);
  }

  // ----- Autorizações prévias -----------------------------------------------------------------
  const AP = (id: string, unidade: string, quem: string, porQuem: string, ate: string, dias: number[] | null, hi: string | null, hf: string | null) => {
    autorizacoes.push({
      id, unidadeId: U(unidade), areaComumId: null, pessoaId: P(quem).id, validaDe: dt('01/09/2026'), validaAte: dt(ate) + DIA - 1, diasSemana: dias,
      horaInicio: hi, horaFim: hf, cadastradaPorId: ID_PAULA, cadastradaEm: dt('01/09/2026 09:00'), solicitadaPorPessoaId: P(porQuem).id,
      semSolicitante: false, justificativa: null, revogadaEm: null, revogadaPorId: null,
    });
  };
  AP('ap-juliana', 'D-32', 'Juliana Costa', 'Ana Ribeiro', '30/11/2026', [1, 2, 3, 4, 5], '08:00', '18:00');
  AP('ap-claudia', 'C-03', 'Cláudia Rocha', 'Mônica Vieira', '30/11/2026', [1, 2, 3, 4, 5], '08:00', '17:00');
  AP('ap-gilberto', 'A-12', 'Gilberto Nascimento', 'Renato Farias', '30/10/2026', [1, 2, 3, 4, 5, 6], '05:30', '19:00');
  AP('ap-lumen', 'F-04', 'Dedetizadora Lumen — Ivo Paes', 'Sílvia Prado', '09/10/2026', null, '15:00', '17:00');
  AP('ap-anapaula', 'H-42', 'Ana Paula Reis', 'Teresa Almeida', '09/10/2026', null, '19:00', '23:00');
  AP('ap-agil', 'E-43', 'Transportes Ágil — equipe de mudança', 'Rita Sampaio', '09/10/2026', null, '08:00', '16:00');

  // ----- Restrições ---------------------------------------------------------------------------
  restricoes.push({
    id: 'rs-bruno', escopo: 'unidade', unidadeId: U('D-32'), pessoaId: P('Bruno Teixeira').id, motivo: 'Morador não autoriza a entrada',
    validaAte: dt('31/12/2026') + DIA - 1, cadastradaPorId: ID_PAULA, cadastradaEm: dt('12/08/2026 10:14'),
    solicitadaPorPessoaId: P('Ana Ribeiro').id, aprovadaPorId: null, aprovadaEm: null, revogadaEm: null, revogadaPorId: null,
  });
  restricoes.push({
    id: 'rs-edu', escopo: 'condominio', unidadeId: U('F-22'), pessoaId: P('Edu Barreto').id,
    motivo: 'Tentativas repetidas de acesso sem autorização em várias unidades', validaAte: dt('31/12/2026') + DIA - 1,
    cadastradaPorId: ID_PAULA, cadastradaEm: dt('08/10/2026 16:20'),
    solicitadaPorPessoaId: P('Gustavo Lins').id, aprovadaPorId: null, aprovadaEm: null, revogadaEm: null, revogadaPorId: null,
  });

  // ----- Eventos (rascunhos) ------------------------------------------------------------------
  const moradoresDe = (u: string) => vinculos.filter((v) => v.unidadeId === u && (v.status === 'aprovado' || v.status === 'legado'));
  function entrada(id: string, ts: number, quem: string, unidade: string | null, meio: MeioAutorizacao, op: string, x: Partial<Omit<Rascunho, 'unidadeId'>> & { auth?: string } = {}) {
    const p = P(quem);
    const aut = x.auth ? P(x.auth) : null;
    const { auth: _auth, ...resto } = x;
    void _auth;
    rascunhos.push({
      id, tipo: 'entrada', pessoaId: p.id, categoria: p.categoria, unidadeId: unidade ? U(unidade) : null, meio, autPessoaId: aut?.id ?? null,
      apId: null, just: null, restricaoId: null, opId: op, ocorrido: ts, registrado: ts,
      retro: false, refere: null, obs: null, ...resto,
    });
  }
  // Saída de entrada retroativa também é retroativa (mesmo formulário); a não retroativa tem ocorrido = registrado.
  function saida(id: string, entradaId: string, ts: number, extra: Partial<Rascunho> = {}) {
    const e = rascunhos.find((r) => r.id === entradaId)!;
    rascunhos.push({
      id, tipo: 'saida', pessoaId: e.pessoaId, categoria: e.categoria, unidadeId: e.unidadeId, meio: null, autPessoaId: null,
      apId: null, just: null, restricaoId: null, opId: e.opId, ocorrido: ts, registrado: e.retro ? Math.max(ts + 60000, e.registrado + 60000) : ts,
      retro: e.retro, refere: entradaId, obs: null, formulario: e.retro ? e.formulario : null, ...extra,
    });
  }

  // Hoje
  entrada('e4818', T('14:18'), 'Juliana Costa', 'D-32', 'autorizacao_previa', ID_JOAO, { apId: 'ap-juliana', auth: 'Ana Ribeiro' });
  entrada('e4817', T('13:55'), 'Marcelo Antunes', 'F-04', 'interfone', ID_JOAO, { auth: 'Sílvia Prado' });
  entrada('e4816', T('13:40'), 'Larissa Gomes', 'A-33', 'morador_presente', ID_JOAO, { auth: 'Ricardo Gomes' });
  saida('e4816s', 'e4816', T('13:52'));
  entrada('e4815', T('12:10'), 'Pedro Almeida', 'H-42', 'interfone', ID_JOAO, { auth: 'Teresa Almeida' });
  entrada('e4814', T('11:02'), 'Cláudia Rocha', 'C-03', 'autorizacao_previa', ID_JOAO, { apId: 'ap-claudia', auth: 'Mônica Vieira' });
  entrada('e4813', T('09:30'), 'Vitor Sampaio', 'E-43', 'excecao_porteiro', ID_JOAO, { just: 'Morador não atende o interfone' });
  entrada('e4812', T('07:45'), 'Rogério Batista', 'B-41', 'interfone', ID_JOAO, { auth: 'Cecília Batista' });
  saida('e4812s', 'e4812', T('09:10'));
  entrada('e4819', T('07:05'), 'Válter Souza', null, 'escala', ID_JOAO);
  entrada('e4811', T('05:40'), 'Gilberto Nascimento', 'A-12', 'autorizacao_previa', ID_SERGIO, { apId: 'ap-gilberto', auth: 'Renato Farias' });
  // Contingência: papel durante queda do sistema, lançado às 06:05 (retroativo)
  entrada('e4810', T('03:10'), 'Fernanda Lins', 'F-22', 'morador_presente', ID_SERGIO, {
    auth: 'Gustavo Lins', retro: true, registrado: T('06:05'), formulario: '0031',
  });
  saida('e4810s', 'e4810', T('04:02'), { registrado: T('06:06') });
  entrada('e4809', T('01:20'), 'Diego Ramos', 'C-14', 'interfone', ID_SERGIO, { auth: 'Patrícia Ramos' });
  saida('e4809s', 'e4809', T('02:15'));
  // Ontem e antes
  entrada('e4808', T('22:47', '08/10/2026'), 'Thiago Moura', 'I-14', 'excecao_porteiro', ID_SERGIO, { just: 'Emergência médica: moradora passou mal e chamou o filho' });
  saida('e4808s', 'e4808', T('23:30', '08/10/2026'));
  entrada('e4807', T('19:12', '08/10/2026'), 'Adriano Melo', 'G-11', 'interfone', ID_SERGIO, { auth: 'Carla Mendes' });
  saida('e4807s', 'e4807', T('19:18', '08/10/2026'));
  entrada('e4806', T('16:05', '08/10/2026'), 'Juliana Costa', 'D-32', 'autorizacao_previa', ID_JOAO, { apId: 'ap-juliana', auth: 'Ana Ribeiro' });
  saida('e4806s', 'e4806', T('17:58', '08/10/2026'));
  rascunhos.push({
    id: 'e4805', tipo: 'negado', pessoaId: P('Bruno Teixeira').id, categoria: 'visitante', unidadeId: U('D-32'), meio: null, autPessoaId: null,
    apId: null, just: null, restricaoId: 'rs-bruno', opId: ID_JOAO,
    ocorrido: T('10:40', '08/10/2026'), registrado: T('10:40', '08/10/2026'), retro: false, refere: null, obs: null,
  });
  entrada('e4804', T('15:20', '07/10/2026'), 'Técnico Sabesp — Caio Lemos', 'H-13', 'excecao_porteiro', ID_MARINA, { just: 'Serviço público (luz, água, gás): vazamento no hidrômetro' });
  saida('e4804s', 'e4804', T('16:05', '07/10/2026'));
  entrada('e4803', T('09:05', '07/10/2026'), 'Marcos Pereira', 'D-32', 'interfone', ID_JOAO, { auth: 'Ana Ribeiro' });
  saida('e4803s', 'e4803', T('11:40', '07/10/2026'));

  // Histórico sintético: 08/09 a 06/10 (para os gráficos de 30 dias). Determinístico.
  const justHist = ['Morador não atende o interfone', 'Serviço público (luz, água, gás)', 'Emergência médica na unidade', 'Vazamento reportado pelo vizinho'];
  const unidadesIds = unidades.map((u) => u.id).filter((u) => moradoresDe(u).length > 0);
  let nh = 0;
  const opPorHora = (h: number) => (h >= 6 && h < 14 ? ID_JOAO : h >= 14 && h < 22 ? ID_SERGIO : ID_MARINA);
  for (let dia = dt('08/09/2026'); dia <= dt('06/10/2026'); dia += DIA) {
    const p = partes(dia);
    const fim = p.dow === 0 || p.dow === 6;
    if (!fim) {
      const id = `eh${++nh}`;
      entrada(id, dia + 7 * HORA + 5 * 60000, 'Válter Souza', null, 'escala', ID_JOAO);
      saida(`${id}s`, id, dia + 16 * HORA);
    }
    const n = (fim ? 4 : 7) + Math.floor(rand() * 7);
    for (let i = 0; i < n; i++) {
      const id = `eh${++nh}`;
      const minutos = 7 * 60 + Math.floor(rand() * 14 * 60);
      const ts = dia + minutos * 60000;
      const unidade = unidadesIds[Math.floor(rand() * unidadesIds.length)];
      const ehPrest = rand() < 0.35;
      const quem = ehPrest ? reservaPrestadores[Math.floor(rand() * reservaPrestadores.length)] : reservaVisitantes[Math.floor(rand() * reservaVisitantes.length)];
      const sorte = rand();
      const moradores = moradoresDe(unidade);
      const mor = moradores[Math.floor(rand() * moradores.length)];
      const op = opPorHora(Math.floor(minutos / 60));
      let meio: MeioAutorizacao = 'interfone';
      const x: Partial<Rascunho> = {};
      if (sorte < 0.1) { meio = 'excecao_porteiro'; x.just = justHist[Math.floor(rand() * justHist.length)]; }
      else if (sorte < 0.28) {
        meio = 'autorizacao_previa'; x.apId = `ap-h${nh}`;
        autorizacoes.push({
          id: x.apId, unidadeId: unidade, areaComumId: null, pessoaId: quem.id, validaDe: dia - 2 * DIA, validaAte: dia + DIA - 1, diasSemana: null,
          horaInicio: '06:00', horaFim: '22:00', cadastradaPorId: ID_PAULA, cadastradaEm: dia - 2 * DIA + 9 * HORA, solicitadaPorPessoaId: mor.pessoaId,
          semSolicitante: false, justificativa: null, revogadaEm: null, revogadaPorId: null,
        });
      } else if (sorte < 0.42) meio = 'morador_presente';
      if (meio !== 'excecao_porteiro') x.autPessoaId = mor.pessoaId;
      if (nh % 83 === 0) { x.retro = true; x.registrado = ts + 4 * HORA; x.formulario = String(nh).padStart(4, '0'); }
      rascunhos.push({
        id, tipo: 'entrada', pessoaId: quem.id, categoria: quem.categoria, unidadeId: unidade, meio, autPessoaId: null, apId: null,
        just: null, restricaoId: null, opId: op, ocorrido: ts, registrado: ts, retro: false, refere: null, obs: null, ...x,
      });
      saida(`${id}s`, id, ts + (20 + Math.floor(rand() * 160)) * 60000);
    }
  }

  // Papel de cada operador do seed (vira `operadorPapel` no evento)
  const PAPEL_USUARIO: Record<string, Papel> = { u1: 'porteiro', u2: 'porteiro', u3: 'porteiro', u4: 'administracao', u5: 'sindico', u6: 'auditor', u7: 'porteiro' };

  // ----- Cadeia de hash -----------------------------------------------------------------------
  const ordenados = rascunhos.map((r, i) => ({ r, i })).sort((a, b) => a.r.registrado - b.r.registrado || a.i - b.i).map((x) => x.r);
  const eventos: EventoAcesso[] = [];
  const porId = new Map(pessoas.map((p) => [p.id, p]));
  let anterior = await hashGenese();
  for (const [i, r] of ordenados.entries()) {
    const seq = i + 1;
    const prestador = r.tipo === 'entrada' && r.categoria === 'prestador' ? porId.get(r.pessoaId) : undefined;
    const base: Omit<EventoAcesso, 'hash'> = {
      id: r.id, seq, formatoHash: FORMATO_HASH, tipo: r.tipo, categoriaPessoa: r.categoria,
      pessoaId: r.pessoaId, unidadeDestinoId: r.unidadeId, areaComumId: null, pontoAcessoId: ID_PORTARIA_SOCIAL, autorizadoPorTipo: r.meio,
      autorizadoPorPessoaId: r.autPessoaId, autorizacaoPreviaId: r.apId, justificativa: r.just,
      restricaoId: r.restricaoId, operadorId: r.opId, operadorPapel: PAPEL_USUARIO[r.opId] ?? 'porteiro', ocorridoEm: r.ocorrido,
      registradoEm: r.registrado, retroativo: r.retro, refereEventoId: r.refere, corrigeEventoId: null, observacao: r.obs,
      formularioContingencia: r.retro ? r.formulario ?? null : null, correcaoValores: null,
      empresa: prestador?.empresa ?? null, servico: prestador?.servico ?? null, hashAnterior: anterior,
    };
    const hash = await calcularHash(base);
    eventos.push({ ...base, hash });
    anterior = hash;
  }

  // ----- Encomendas ---------------------------------------------------------------------------
  const ID_POR_NOME: Record<string, string> = { 'João Lima': ID_JOAO, 'Sérgio Matos': ID_SERGIO, 'Marina Couto': ID_MARINA };
  const K = (n: number, unidade: string, dest: string, transp: string, rastreio: string, quando: string, por: string, ret?: { quem: string; em: string; por: string }): Encomenda => ({
    id: `K${n}`, codigo: `K${n}`, unidadeId: U(unidade), destinatario: dest, transportadora: transp, codigoRastreio: rastreio, recebidaPorId: ID_POR_NOME[por],
    recebidaEm: dt(quando), unidadeConfirmada: true,
    retiradaEm: ret ? dt(ret.em) : null, retiradaPorPessoaId: ret ? P(ret.quem).id : null,
    retiradaRegistradaPorId: ret ? ID_POR_NOME[ret.por] : null, retiradaAutorizacaoId: null,
  });
  const encomendas: Encomenda[] = [
    K(108, 'D-32', 'Ana Ribeiro', 'Mercado Livre', 'MLB-88231904', '09/10/2026 10:22', 'João Lima'),
    K(107, 'H-42', 'Teresa Almeida', 'Loggi', 'LG-55210983', '09/10/2026 08:47', 'João Lima'),
    K(106, 'G-11', 'Carla Mendes', 'Correios', 'QB 482 913 775 BR', '08/10/2026 15:31', 'João Lima'),
    K(105, 'B-24', 'Helena Duarte', 'Amazon', 'TBA309281882100', '07/10/2026 11:02', 'Marina Couto'),
    K(104, 'F-22', 'Gustavo Lins', 'Jadlog', '10822339410', '06/10/2026 17:44', 'Sérgio Matos'),
    K(103, 'E-43', 'Rita Sampaio', 'Shopee', 'BR254988332197', '04/10/2026 13:15', 'João Lima'),
    K(102, 'I-13', 'Marta Siqueira', 'Shopee', 'BR254988330041', '30/09/2026 16:20', 'Marina Couto'),
    K(101, 'A-12', 'Renato Farias', 'Correios', 'QA 119 554 120 BR', '28/09/2026 09:58', 'João Lima'),
    K(100, 'C-14', 'Patrícia Ramos', 'Correios', 'QB 401 223 908 BR', '08/10/2026 12:40', 'João Lima', { quem: 'Patrícia Ramos', em: '09/10/2026 10:15', por: 'João Lima' }),
    K(99, 'D-32', 'Paulo Ribeiro', 'Amazon', 'TBA309112450200', '07/10/2026 14:05', 'Marina Couto', { quem: 'Paulo Ribeiro', em: '08/10/2026 19:02', por: 'Sérgio Matos' }),
  ];

  // ----- Ocorrências --------------------------------------------------------------------------
  const O = (n: number, quando: string, tipo: Ocorrencia['tipo'], unidade: string | null, env: string, desc: string, status: Ocorrencia['status'], por: string, ev: string[] = []): Ocorrencia => ({
    id: `OC-2026-0${n}`, codigo: `OC-2026-0${n}`, tipo, descricao: desc, unidadeId: unidade ? U(unidade) : null, envolvidos: env,
    abertaPorId: ID_POR_NOME[por], abertaEm: dt(quando), status, historicoStatus: [], anexos: [], eventoIds: ev,
  });
  const ocorrencias: Ocorrencia[] = [
    O(47, '09/10/2026 08:12', 'dano', null, '—', 'Portão da garagem B travando ao fechar. Zeladoria avisada.', 'aberta', 'João Lima'),
    O(46, '08/10/2026 22:50', 'conflito', 'I-14', 'Thiago Moura', 'Discussão entre visitante e vizinho no hall do Bloco I durante atendimento de emergência.', 'aberta', 'Sérgio Matos', ['e4808']),
    O(45, '05/10/2026 17:30', 'encomenda', 'G-11', 'Carla Mendes', 'Moradora relatou encomenda de agosto entregue na G-12. Registro feito para histórico.', 'encerrada', 'Marina Couto'),
    O(44, '01/10/2026 18:55', 'tentativa_acesso_indevido', 'I-13', 'Rodrigo Alves', 'Homem apresentou contrato de locação da I-13 e pediu cópia das chaves. Orientado a procurar a administração; o pedido de vínculo foi aberto pela administração e aguarda análise.', 'em_andamento', 'Sérgio Matos'),
    O(43, '14/09/2026 10:02', 'tentativa_acesso_indevido', 'D-32', 'Bruno Teixeira', 'Tentativa de entrada sem autorização. Moradora solicitou restrição.', 'encerrada', 'João Lima'),
  ];

  const Usr = (id: string, nome: string, login: string, papel: UsuarioSistema['papel'], ativo: boolean, ult: string): UsuarioSistema =>
    ({ id, nome, login, papel, ativo, ultimoAcesso: dt(ult) });
  const usuarios: UsuarioSistema[] = [
    Usr('u1', 'João Lima', 'joao.lima', 'porteiro', true, '09/10/2026 06:01'),
    Usr('u2', 'Sérgio Matos', 'sergio.matos', 'porteiro', true, '09/10/2026 06:02'),
    Usr('u3', 'Marina Couto', 'marina.couto', 'porteiro', true, '07/10/2026 18:01'),
    Usr('u4', 'Paula Nogueira', 'paula.nogueira', 'administracao', true, '09/10/2026 09:14'),
    Usr('u5', 'Roberto Faria', 'roberto.faria', 'sindico', true, '08/10/2026 20:37'),
    Usr('u6', 'Luíza Campos', 'luiza.campos', 'auditor', true, '02/10/2026 16:50'),
    Usr('u7', 'Edson Ramos', 'edson.ramos', 'porteiro', false, '14/06/2026 05:58'),
  ];

  // documentoBusca = HMAC-SHA256 do CPF com a chave de demonstração (nunca o CPF em claro)
  for (const p of pessoas) p.documentoBusca = await documentoBuscaCpf(cpfs.get(p.id)!, CHAVE_HMAC_DEMO);

  return {
    versao: VERSAO_DB, pessoas, funcionarios, unidades, areasComuns, pontosAcesso, vinculos, veiculos, autorizacoes, restricoes, eventos,
    encomendas, autorizacoesRetirada: [], ocorrencias, usuarios, importacoes: [], auditLog: [], salvoEm: brt(2026, 10, 9, 14, 32),
  };
}
