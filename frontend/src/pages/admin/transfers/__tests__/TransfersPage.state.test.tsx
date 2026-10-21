import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, it, expect, vi } from 'vitest';
import { ConfirmDialogProvider } from '../../../../components/common';
import { TransfersPage } from '../TransfersPage';
import { transfersService } from '../../../../services/transfers.service';
vi.mock('../../../../services/transfers.service', () => ({ transfersService: {
  list:vi.fn(), get:vi.fn(), update:vi.fn(), adminDownloadUrl:() => '/test-download', downloadUpload:vi.fn(),
} }));
vi.mock('../../../../hooks/useLocalizedDate', () => ({ useLocalizedDate: () => ({ formatDateTime: (d:string) => d }) }));
vi.mock('react-toastify', () => ({ toast: { success:vi.fn(), error:vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('refreshes the open detail and underlying list after disabling a link; disabled uploads retain history', async () => {
  let active = true;
  const snapshot = () => ({ id:8, title:'Transfer sample', token:'sample', is_active:active,
    status:active ? 'active':'expired', expires_at:null, file_count:0, download_count:0, upload_count:1,
    allow_uploads:false, files:[], extra_files:[], uploads:[{id:2,original_filename:'return.png',size_bytes:306,mime_type:'image/png'}] });
  vi.mocked(transfersService.list).mockImplementation(async () => [snapshot()] as any);
  vi.mocked(transfersService.get).mockImplementation(async () => snapshot() as any);
  vi.mocked(transfersService.update).mockImplementation(async () => { active=false; return snapshot() as any; });
  vi.mocked(transfersService.downloadUpload).mockResolvedValue(undefined);
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><ConfirmDialogProvider><TransfersPage /></ConfirmDialogProvider></QueryClientProvider>);
  fireEvent.click(await screen.findByText('Transfer sample'));
  fireEvent.click(await screen.findByRole('button', {name:'Disable link'}));
  await waitFor(() => expect(screen.getAllByText('Expired')).toHaveLength(2));
  fireEvent.click(screen.getByRole('button', {name:'Download return.png'}));
  expect(transfersService.downloadUpload).toHaveBeenCalledWith(8,2,'return.png');
  client.clear();
});
