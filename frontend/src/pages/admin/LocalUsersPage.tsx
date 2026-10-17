import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../config/api';
import { Button, Card, Input } from '../../components/common';
import { RoleManagementTab } from '../../components/admin/RoleManagementTab';
import { toast } from 'react-toastify';

export const LocalUsersPage = () => {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState('');
  const [activePanel, setActivePanel] = useState<'users' | 'roles'>('users');
  const { data, isError, isLoading } = useQuery({ queryKey: ['local-users'], queryFn: async () => (await api.get<{ users: { id: number; username: string; role: string; role_id: number; is_active: boolean }[]; roles: { id: number; name: string; display_name: string }[] }>('/admin/local-users')).data });
  const create = useMutation({
    mutationFn: async () => api.post('/admin/local-users', { username, password, role_id: Number(role) }),
    onSuccess: () => { setUsername(''); setPassword(''); setError(''); cache.invalidateQueries({ queryKey: ['local-users'] }); },
    onError: (err: any) => { setError(err?.response?.data?.error || t('localUsers.createError')); },
  });
  const update = useMutation({
    mutationFn: async ({ id, ...body }: { id: number; role_id?: number; is_active?: boolean }) => api.patch(`/admin/local-users/${id}`, body),
    onSuccess: () => { cache.invalidateQueries({ queryKey: ['local-users'] }); toast.success(t('localUsers.updateSuccess')); },
    onError: (err: any) => toast.error(err?.response?.data?.error || t('localUsers.updateError')),
  });
  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/admin/local-users/${id}`),
    onSuccess: () => { cache.invalidateQueries({ queryKey: ['local-users'] }); toast.success(t('localUsers.deleteSuccess')); },
    onError: (err: any) => toast.error(err?.response?.data?.error || t('localUsers.deleteError')),
  });
  if (isLoading) return <p role="status" className="p-6 text-neutral-600">{t('ui.loading')}</p>;
  if (isError || !data) return (
    <main className="mx-auto max-w-2xl rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-800">
      <h1 className="text-2xl font-bold">{t('localUsers.title')}</h1>
      <p role="alert" className="mt-2 text-neutral-600 dark:text-neutral-300">{t('localUsers.loadError')}</p>
    </main>
  );
  return <div className="space-y-6"><h1 className="text-2xl font-bold">{t('localUsers.title')}</h1>
    <div className="flex gap-2 border-b" role="tablist" aria-label={t('localUsers.title')}>
      <button id="local-users-tab" type="button" role="tab" aria-label={t('localUsers.accountsTab')} aria-controls="local-users-panel" aria-selected={activePanel === 'users'} className="px-3 py-2 border-b-2 aria-selected:border-blue-600" onClick={() => setActivePanel('users')}>{t('localUsers.accountsTab')}</button>
      <button id="local-roles-tab" type="button" role="tab" aria-label={t('localUsers.rolesTab')} aria-controls="local-roles-panel" aria-selected={activePanel === 'roles'} className="px-3 py-2 border-b-2 aria-selected:border-blue-600" onClick={() => setActivePanel('roles')}>{t('localUsers.rolesTab')}</button>
    </div>
    {activePanel === 'roles' ? <div id="local-roles-panel" role="tabpanel" aria-labelledby="local-roles-tab"><RoleManagementTab /></div> : <div id="local-users-panel" role="tabpanel" aria-labelledby="local-users-tab">
    <Card><h2 className="text-lg font-semibold mb-4">{t('localUsers.existingTitle')}</h2>
      <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>{t('localUsers.username')}</th><th>{t('localUsers.role')}</th><th>{t('localUsers.status')}</th><th>{t('localUsers.actions')}</th></tr></thead><tbody>{data?.users.map(u => <tr key={u.id} className="border-t border-neutral-200 dark:border-neutral-700"><td className="py-2">{u.username}</td><td className="py-2"><select aria-label={`${t('localUsers.role')} ${u.username}`} className="input" value={u.role_id} onChange={e => update.mutate({ id: u.id, role_id: Number(e.target.value) })} disabled={update.isPending}>{data.roles.map(r => <option key={r.id} value={r.id}>{t(`users.roles.${r.name}`, { defaultValue: r.display_name })}</option>)}</select></td><td className="py-2">{u.is_active ? t('localUsers.enabled') : t('localUsers.disabled')}</td><td className="py-2"><div className="flex gap-2"><Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ id: u.id, is_active: !u.is_active })}>{u.is_active ? t('localUsers.deactivate') : t('localUsers.activate')}</Button><Button size="sm" variant="outline" disabled={remove.isPending} onClick={() => { if (window.confirm(t('localUsers.deleteConfirm', { username: u.username }))) remove.mutate(u.id); }}>{t('localUsers.delete')}</Button></div></td></tr>)}</tbody></table></div>
    </Card>
    <Card><h2 className="text-lg font-semibold mb-4">{t('localUsers.createTitle')}</h2><p className="mb-4 text-sm text-neutral-500">{t('localUsers.createHelp')}</p>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
        <Input id="local-user-username" aria-label={t('localUsers.username')} label={t('localUsers.username')} value={username} autoComplete="off" onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={50} />
        <Input id="local-user-password" aria-label={t('localUsers.initialPassword')} label={t('localUsers.initialPassword')} type="password" value={password} autoComplete="new-password" onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={128} />
        <label htmlFor="local-user-role" className="block">{t('localUsers.role')}<select id="local-user-role" aria-label={t('localUsers.role')} className="input ml-3" required value={role} onChange={e => setRole(e.target.value)}><option value="">{t('localUsers.chooseRole')}</option>{data?.roles.map(r => <option key={r.id} value={r.id}>{t(`users.roles.${r.name}`, { defaultValue: r.display_name })}</option>)}</select></label>
        {error && <p role="alert" className="text-red-600">{error}</p>}<Button type="submit" aria-label={t('localUsers.createButton')} disabled={create.isPending}>{create.isPending ? t('localUsers.creating') : t('localUsers.createButton')}</Button>
      </form>
    </Card>
    </div>}
  </div>;
};
