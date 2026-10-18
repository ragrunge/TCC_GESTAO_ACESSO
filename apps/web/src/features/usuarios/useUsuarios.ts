// Server state de usuários (React Query v5). A senha temporária NÃO passa pelo cache: as mutations que a recebem
// entregam a senha a `aoReceberSenha` (estado local da tela) e devolvem ao React Query só o usuário.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi, type NovoUsuarioInput, type UsuarioComSenhaTemporaria } from '../../api';
import type { Papel } from '@portaria/domain/types';

export const CHAVE_USUARIOS = ['usuarios'] as const;

export function useUsuarios(habilitado: boolean) {
  const api = useApi();
  // `enabled`: quem não gerencia usuários nem chega a pedir a lista (evita 403 à toa).
  return useQuery({ queryKey: CHAVE_USUARIOS, queryFn: () => api.usuarios.listar(), enabled: habilitado });
}

export function useAcoesUsuario(aoReceberSenha: (r: UsuarioComSenhaTemporaria, origem: 'criado' | 'redefinido') => void) {
  const api = useApi();
  const qc = useQueryClient();
  const invalidar = () => qc.invalidateQueries({ queryKey: CHAVE_USUARIOS });
  const comSenha = (r: UsuarioComSenhaTemporaria, origem: 'criado' | 'redefinido') => { aoReceberSenha(r, origem); return r.usuario; };

  return {
    criar: useMutation({
      mutationFn: async (i: NovoUsuarioInput) => comSenha(await api.usuarios.criar(i), 'criado'),
      onSuccess: invalidar,
    }),
    redefinirAcesso: useMutation({
      mutationFn: async (id: string) => comSenha(await api.usuarios.redefinirAcesso(id), 'redefinido'),
      onSuccess: invalidar,
    }),
    desativar: useMutation({ mutationFn: (id: string) => api.usuarios.desativar(id), onSuccess: invalidar }),
    reativar: useMutation({ mutationFn: (id: string) => api.usuarios.reativar(id), onSuccess: invalidar }),
    alterarPapel: useMutation({
      mutationFn: (v: { id: string; papel: Papel }) => api.usuarios.alterarPapel(v.id, v.papel),
      // 403/422 também invalidam: o <select> volta ao papel que o servidor tem.
      onSettled: invalidar,
    }),
  };
}
