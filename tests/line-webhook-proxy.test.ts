import { describe, expect, it } from 'vitest';
import {
  LINE_WEBHOOK_PATH,
  LINE_WEBHOOK_PROXY_HOST,
  LINE_WEBHOOK_PROXY_PORT,
  LINE_WEBHOOK_TARGET_PORT,
  readProxyConfig,
  shouldForwardWebhook,
} from '../scripts/line-webhook-proxy';

describe('LINE webhook development proxy', () => {
  it('defaults to the loopback proxy and local Next.js target', () => {
    const config = readProxyConfig({} as NodeJS.ProcessEnv);
    expect(config.host).toBe(LINE_WEBHOOK_PROXY_HOST);
    expect(config.port).toBe(LINE_WEBHOOK_PROXY_PORT);
    expect(config.targetUrl).toBe(`http://localhost:${LINE_WEBHOOK_TARGET_PORT}${LINE_WEBHOOK_PATH}`);
  });

  it('allows configured ports without persisting a tunnel URL', () => {
    const config = readProxyConfig({
      LINE_WEBHOOK_PROXY_HOST: '127.0.0.2',
      LINE_WEBHOOK_PROXY_PORT: '40474',
      LINE_WEBHOOK_TARGET_HOST: '127.0.0.3',
      LINE_WEBHOOK_TARGET_PORT: '40274',
    });
    expect(config).toEqual({
      host: '127.0.0.2',
      port: 40474,
      targetUrl: 'http://127.0.0.3:40274/api/line/webhook',
    });
  });

  it('forwards only the exact signed webhook route', () => {
    expect(shouldForwardWebhook('POST', LINE_WEBHOOK_PATH)).toBe(true);
    expect(shouldForwardWebhook('post', LINE_WEBHOOK_PATH)).toBe(false);
    expect(shouldForwardWebhook('POST', `${LINE_WEBHOOK_PATH}?x=1`)).toBe(false);
    expect(shouldForwardWebhook('GET', LINE_WEBHOOK_PATH)).toBe(false);
  });
});
