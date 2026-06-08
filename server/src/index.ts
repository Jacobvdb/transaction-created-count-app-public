import { Hono } from 'hono';
import type { Env } from '../../env.js';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('*', (c) => {
    const url = new URL(c.req.url);

    if (!isStaticAssetPath(url.pathname)) {
        url.pathname = '/index.html';
    }

    return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});

function isStaticAssetPath(pathname: string): boolean {
    return pathname.split('/').pop()?.includes('.') ?? false;
}

export default app;
