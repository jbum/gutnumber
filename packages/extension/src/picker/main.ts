import { startPicker } from './picker.js';
import type { ApiResponse, PickerConfig, Transport } from '../transport.js';

/* Content script injected by the service worker. Talks to the API through chrome.runtime (no CORS). */
const w = window as unknown as { __gutnumberPicker?: () => void };
if (w.__gutnumberPicker) w.__gutnumberPicker();
else {
  const transport: Transport = {
    config: () => chrome.runtime.sendMessage({ type: 'config' }) as Promise<PickerConfig>,
    post: <T>(path: string, body: unknown) => chrome.runtime.sendMessage({ type: 'post', path, body }) as Promise<ApiResponse<T>>,
    openTab: (url: string) => void chrome.runtime.sendMessage({ type: 'open', url }),
  };
  w.__gutnumberPicker = startPicker(transport);
}
