// Condomínio único (src/condominio): nome e chaves do ambiente, agrupamento da tabela `configuracao` e a conferência da
// KEK no boot (com anexo cifrado existente, KEK trocada derruba o boot em vez de gravar com uma chave e não ler com outra).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { carregarCondominio, ErroCondominio } from '../src/condominio/carregar';
import type { Db } from '../src/database/database.module';
import * as s from '../src/db/schema';
import { type ApiDeTeste, configDeTeste, KEK_TESTE, NOME_CONDOMINIO_TESTE, novaApi } from './helpers/app';
import { CHAVE_HMAC_TESTE } from './helpers/banco';

const V1 = '/api/v1';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('ANEXO '.repeat(10))]);

describe('condomínio único: carga no boot', () => {
  let api: ApiDeTeste;
  const db = () => api.db as unknown as Db;
  const config = (kek: Buffer, kekVersao = 1) => configDeTeste({
    condominio: { nome: NOME_CONDOMINIO_TESTE, chaves: { hmacCpf: CHAVE_HMAC_TESTE, kek, kekVersao } },
  });

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    api = await novaApi();
  });
  afterAll(async () => { await api.app.close(); await api.client.close(); vi.restoreAllMocks(); });

  it('login e /auth/me devolvem só o nome do condomínio; sem anexo, qualquer KEK sobe; agrupamento padrão sem a linha', async () => {
    const { cookie, corpo } = await api.como('sindico');
    expect(corpo.condominio).toEqual({ nome: NOME_CONDOMINIO_TESTE });
    expect(corpo).not.toHaveProperty('modulos');
    const me = await api.http().get(`${V1}/auth/me`).set('Cookie', cookie);
    expect(me.body.data.condominio).toEqual({ nome: NOME_CONDOMINIO_TESTE });
    const c = await carregarCondominio(config(Buffer.alloc(32, 1)), db());
    expect(c).toMatchObject({ nome: NOME_CONDOMINIO_TESTE, agrupamento: 'Bloco' });
  });

  it('o cookie da sessão é o token puro; cookie em outro formato dá 401 sem consultar sessão', async () => {
    const { cookie } = await api.como('porteiro');
    expect(cookie.split('=')[1]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const forjado = `${cookie.split('=')[0]}=v2.00000000-0000-0000-0000-000000000000.${cookie.split('=')[1]}`;
    const r = await api.http().get(`${V1}/auth/me`).set('Cookie', forjado);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('SESSAO_INVALIDA');
  });

  it('com anexo cifrado existente: a KEK certa sobe, a trocada recusa o boot; outra versão não é conferida contra ele', async () => {
    const { cookie } = await api.como('porteiro');
    const oc = (await api.http().post(`${V1}/ocorrencias`).set('Cookie', cookie).send({ tipo: 'dano', descricao: 'Portão riscado', unidadeId: null })).body.data.id;
    const up = await api.http().post(`${V1}/ocorrencias/${oc}/anexos`).set('Cookie', cookie).attach('arquivo', PNG, { filename: 'f.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    await expect(carregarCondominio(config(KEK_TESTE), db())).resolves.toMatchObject({ chaves: { kekVersao: 1 } });
    await expect(carregarCondominio(config(Buffer.alloc(32, 3)), db())).rejects.toBeInstanceOf(ErroCondominio);
    // KEK nova numa versão nova (rotação): nenhum anexo dessa versão ainda, nada a conferir.
    await expect(carregarCondominio(config(Buffer.alloc(32, 3), 2), db())).resolves.toMatchObject({ chaves: { kekVersao: 2 } });
  });

  it('agrupamento vem da tabela configuracao', async () => {
    await api.db.insert(s.configuracao).values({ agrupamento: 'Torre' });
    expect((await carregarCondominio(config(KEK_TESTE), db())).agrupamento).toBe('Torre');
  });
});
