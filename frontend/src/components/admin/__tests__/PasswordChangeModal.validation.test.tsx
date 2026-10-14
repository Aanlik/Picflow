import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { changePassword } = vi.hoisted(() => ({ changePassword: vi.fn() }));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const messages: Record<string, string> = {
    'passwordChange.minLengthError': '密码必须至少为 12 个字符',
    'mandatoryPasswordChange.mustContainLowercase': '密码必须包含小写字母',
    'mandatoryPasswordChange.mustContainUppercase': '密码必须包含大写字母',
    'mandatoryPasswordChange.mustContainNumbersError': '密码必须包含数字',
    'mandatoryPasswordChange.mustContainSpecialError': '密码必须包含特殊字符',
    'passwordChange.currentPassword': '当前密码',
    'passwordChange.newPassword': '新密码',
    'passwordChange.confirmPassword': '确认新密码',
    'passwordChange.title': '更改密码',
    'passwordChange.requirements': '密码要求：',
    'passwordChange.minLength': '至少12个字符',
    'mandatoryPasswordChange.mustContainUpperLower': '必须包含大写和小写字母',
    'mandatoryPasswordChange.mustContainNumbers': '必须包含数字',
    'mandatoryPasswordChange.mustContainSpecial': '必须包含特殊字符',
    'passwordChange.mustDiffer': '必须与当前密码不同',
    'passwordChange.currentPasswordPlaceholder': '输入当前密码',
    'passwordChange.newPasswordPlaceholder': '输入新密码',
    'passwordChange.confirmPasswordPlaceholder': '确认新密码',
    'passwordChange.currentRequired': '需要当前密码',
    'passwordChange.newRequired': '需要新密码',
    'passwordChange.confirmRequired': '请确认新密码',
    'passwordChange.noMatch': '两次密码不一致',
    'passwordChange.mustBeDifferent': '新密码必须与当前密码不同',
    'passwordChange.cancel': '取消',
  };
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => messages[key] ?? key }),
  };
});

vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../services/admin.service', () => ({
  adminService: { changePassword },
}));

import { PasswordChangeModal } from '../PasswordChangeModal';

function renderModal() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PasswordChangeModal isOpen onClose={vi.fn()} />
    </QueryClientProvider>
  );
}

describe('PasswordChangeModal validation', () => {
  beforeEach(() => {
    changePassword.mockReset();
    changePassword.mockReturnValue(new Promise(() => {}));
  });

  const submitPassword = (newPassword: string) => {
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'current-password' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: newPassword } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: newPassword } });
    fireEvent.click(screen.getByRole('button', { name: '更改密码' }));
  };

  it('rejects passwords shorter than the backend minimum before sending a request', () => {
    renderModal();
    submitPassword('Short123!ab');

    expect(screen.getByText('密码必须至少为 12 个字符')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('requires the same character classes as the backend strength check', () => {
    renderModal();
    submitPassword('StrongPassword123');

    expect(screen.getByText('密码必须包含特殊字符')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it.each([
    ['STRONGPASS123!', '密码必须包含小写字母'],
    ['strongpass123!', '密码必须包含大写字母'],
    ['StrongPassword!', '密码必须包含数字'],
  ])('rejects passwords missing a required character type', (password, error) => {
    renderModal();
    submitPassword(password);

    expect(screen.getByText(error)).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('sends a password that meets the backend length and character requirements', async () => {
    renderModal();
    submitPassword('StrongPass123!');

    expect(screen.getByLabelText('新密码')).toHaveValue('StrongPass123!');
    expect(screen.getByLabelText('确认新密码')).toHaveValue('StrongPass123!');
    expect(screen.getByLabelText('新密码')).toHaveAttribute('aria-invalid', 'false');
    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(1));
  });
});
