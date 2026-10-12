import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoleEditorModal } from '../RoleEditorModal';

const { translations } = vi.hoisted(() => ({
  translations: {
    'users.roles.viewer': '查看者',
    'users.roleDescriptions.viewer': '只读查看概览和项目。',
    'roleEditor.editTitle': '编辑角色：{{name}}',
    'roleEditor.systemRole': '系统角色',
    'roleEditor.systemRoleIdentifier': '系统内置标识（不可修改）',
    'roleEditor.categories.events': '项目',
    'roleEditor.categories.other': '其他权限',
    'roleEditor.permissionLabels.events_view': '查看项目',
    'roleEditor.untranslatedPermission': '权限名称待补充',
    'roleEditor.permissions': '权限设置',
    'roleEditor.selectedCount': '已选 {{count}} 项',
    'roleEditor.selectAll': '全选',
    'roleEditor.clearAll': '清空',
    'roleEditor.description': '角色说明',
    'roleEditor.descriptionPlaceholder': '说明此角色的用途',
    'roleEditor.displayName': '角色名称',
    'roleEditor.key': '角色标识',
    'roleEditor.keyLocked': '角色创建后，标识不可修改。',
    'roleEditor.view': '查看权限',
    'roleEditor.displayNamePlaceholder': '例如：摄影师',
    'roleEditor.superAdminLocked': '超级管理员权限不可修改。',
    'common.cancel': '取消',
    'common.save': '保存',
  },
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string }) => translations[key] ?? options?.defaultValue ?? key,
    }),
  };
});

afterEach(cleanup);

describe('role permission translations', () => {
  it('localizes permissions and avoids exposing English API labels for unknown keys', () => {
    render(<RoleEditorModal
      isOpen
      mode="edit"
      role={{ id: 1, name: 'viewer', displayName: 'Viewer', description: 'Read-only access', isSystem: true, priority: 1, permissions: ['events.view'], userCount: 1 }}
      catalog={[
        { id: 1, name: 'events.view', display_name: 'View Events', category: 'events', description: 'View event list' },
        { id: 2, name: 'unknown.manage', display_name: 'Manage Something', category: 'unknown', description: 'Manage something' },
      ]}
      isLoading={false}
      onClose={() => {}}
      onSave={() => {}}
    />);

    expect(screen.getByText('查看项目')).toBeTruthy();
    expect(screen.getByText('权限名称待补充')).toBeTruthy();
    expect(screen.getByDisplayValue('查看者')).toBeTruthy();
    expect(screen.queryByText('View Events')).toBeNull();
    expect(screen.queryByText('Manage Something')).toBeNull();
  });
});
