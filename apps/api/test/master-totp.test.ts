// TOTP do Master (src/master/totp.ts) contra os vetores da RFC 6238 (apêndice B) e da RFC 4226 (apêndice D), janela de
// ±1 passo, anti-replay e o segredo cifrado pela chave mestra (src/master/segredo-totp.ts).
import { describe, expect, it } from 'vitest';
import { cifrarSegredoTotp, decifrarSegredoTotp } from '../src/master/segredo-totp';
import { base32, deBase32, hotp, passoDe, totp, uriOtpauth, verificarTotp } from '../src/master/totp';
import { ErroChave } from '../src/saas/chave-mestra';
import { MESTRA_TESTE } from './helpers/saas';

const SEGREDO_RFC = Buffer.from('12345678901234567890', 'ascii');

describe('vetores das RFCs', () => {
  it('RFC 4226 apêndice D: HOTP 6 dígitos, contadores 0 a 9', () => {
    const esperado = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expect(esperado.map((_, i) => hotp(SEGREDO_RFC, i))).toEqual(esperado);
  });

  it('RFC 6238 apêndice B: SHA1, 8 dígitos, e os 6 dígitos que o app mostra (mesmo valor mod 10^6)', () => {
    const casos: [number, string][] = [
      [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
      [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130'],
    ];
    for (const [t, oito] of casos) {
      const instante = new Date(t * 1000);
      expect(totp(SEGREDO_RFC, instante, 8)).toBe(oito);
      expect(totp(SEGREDO_RFC, instante)).toBe(oito.slice(2));
    }
  });

  it('RFC 6238 apêndice B também para SHA256 e SHA512 (o algoritmo do HOTP é o da RFC)', () => {
    const s256 = Buffer.from('12345678901234567890123456789012', 'ascii');
    const s512 = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234', 'ascii');
    expect(hotp(s256, passoDe(new Date(59_000)), 8, 'sha256')).toBe('46119246');
    expect(hotp(s512, passoDe(new Date(59_000)), 8, 'sha512')).toBe('90693936');
  });

  it('base32 (RFC 4648) ida e volta, tolerante a minúsculas, espaços e preenchimento', () => {
    expect(base32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(deBase32('mzxw 6ytb oi==').toString()).toBe('foobar');
    expect(deBase32(base32(SEGREDO_RFC))).toEqual(SEGREDO_RFC);
    expect(() => deBase32('ABC1')).toThrow(/base32/);
  });
});

describe('verificação', () => {
  const agora = new Date('2026-10-23T12:00:10Z');
  const p = passoDe(agora);

  it('aceita o passo atual e os vizinhos (±1); recusa ±2 e formato errado', () => {
    expect(verificarTotp(SEGREDO_RFC, hotp(SEGREDO_RFC, p), agora, null)).toBe(p);
    expect(verificarTotp(SEGREDO_RFC, hotp(SEGREDO_RFC, p - 1), agora, null)).toBe(p - 1);
    expect(verificarTotp(SEGREDO_RFC, hotp(SEGREDO_RFC, p + 1), agora, null)).toBe(p + 1);
    expect(verificarTotp(SEGREDO_RFC, hotp(SEGREDO_RFC, p - 2), agora, null)).toBeNull();
    expect(verificarTotp(SEGREDO_RFC, hotp(SEGREDO_RFC, p + 2), agora, null)).toBeNull();
    expect(verificarTotp(SEGREDO_RFC, '12345', agora, null)).toBeNull();
    expect(verificarTotp(SEGREDO_RFC, '12345a', agora, null)).toBeNull();
  });

  it('anti-replay: o passo já aceito e os anteriores não valem de novo; um posterior vale', () => {
    const codigo = hotp(SEGREDO_RFC, p);
    expect(verificarTotp(SEGREDO_RFC, codigo, agora, p)).toBeNull();
    expect(verificarTotp(SEGREDO_RFC, hotp(SEGREDO_RFC, p - 1), agora, p)).toBeNull();
    expect(verificarTotp(SEGREDO_RFC, hotp(SEGREDO_RFC, p + 1), agora, p)).toBe(p + 1);
  });

  it('URI otpauth com emissor, conta, SHA1, 6 dígitos e 30 s', () => {
    const texto = uriOtpauth(SEGREDO_RFC, 'master@exemplo.test');
    expect(texto.startsWith('otpauth://totp/Portaria%20Parque:master%40exemplo.test?')).toBe(true);
    const u = new URL(texto);
    expect(Object.fromEntries(u.searchParams)).toEqual({ secret: base32(SEGREDO_RFC), issuer: 'Portaria Parque', algorithm: 'SHA1', digits: '6', period: '30' });
  });
});

describe('segredo cifrado pela chave mestra', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('ida e volta; o cifrado não contém o segredo; nonce novo a cada cifragem', () => {
    const a = cifrarSegredoTotp(MESTRA_TESTE, id, SEGREDO_RFC);
    const b = cifrarSegredoTotp(MESTRA_TESTE, id, SEGREDO_RFC);
    expect(a.totpCifrado.length).toBe(12 + 20 + 16);
    expect(a.totpCifrado.includes(SEGREDO_RFC)).toBe(false);
    expect(a.totpCifrado.equals(b.totpCifrado)).toBe(false);
    expect(decifrarSegredoTotp(MESTRA_TESTE, id, a)).toEqual(SEGREDO_RFC);
  });

  it('AAD amarra ao usuário; mestra errada ou de outra versão falha', () => {
    const a = cifrarSegredoTotp(MESTRA_TESTE, id, SEGREDO_RFC);
    expect(() => decifrarSegredoTotp(MESTRA_TESTE, '22222222-2222-4222-8222-222222222222', a)).toThrow(ErroChave);
    expect(() => decifrarSegredoTotp({ chave: Buffer.alloc(32, 7), versao: 1 }, id, a)).toThrow(/não autenticou/);
    expect(() => decifrarSegredoTotp({ ...MESTRA_TESTE, versao: 2 }, id, a)).toThrow(/v1/);
  });
});
