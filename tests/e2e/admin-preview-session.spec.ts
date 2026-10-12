import { test, expect } from '@playwright/test';
import { adminApiToken } from './_helpers/admin';

test('admin gallery preview has no customer logout control and keeps the workbench session', async ({ page }) => {
  const token = await adminApiToken(page.request);
  const eventName = `Admin preview ${Date.now()}`;
  const created = await page.request.post('/api/admin/events', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      event_type: 'wedding',
      event_name: eventName,
      event_date: new Date().toISOString().slice(0, 10),
      customer_name: 'Preview test',
      password: 'PreviewTest123!',
      expiration_days: 30,
      allow_user_uploads: false,
      allow_downloads: true,
    },
  });
  expect(created.ok(), `project creation failed: ${created.status()} ${await created.text()}`).toBeTruthy();
  const event = await created.json();

  await page.goto(`${event.share_link}?admin_preview=1`);
  await expect(page.getByRole('heading', { name: eventName })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /log out|logout|退出登录/i })).toHaveCount(0);

  await page.goto('/admin/dashboard');
  await expect(page.getByRole('heading', { name: /dashboard|概览/i })).toBeVisible({ timeout: 20_000 });
});
