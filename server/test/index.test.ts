import { describe, expect, test } from 'bun:test';
import app from '../src/index.js';
import type { Env } from '../../env.js';

function createTestEnv(): Env {
    const assetFetch: typeof fetch = async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        return Response.json({ pathname: new URL(request.url).pathname });
    };

    return {
        ASSETS: { fetch: assetFetch },
    };
}

describe('server worker', () => {
    test('reports health without touching assets', async () => {
        const response = await app.request(
            'https://example.com/health',
            undefined,
            createTestEnv(),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok' });
    });

    test('passes static asset paths through to the assets binding', async () => {
        const response = await app.request(
            'https://example.com/images/logo-light.svg',
            undefined,
            createTestEnv(),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            pathname: '/images/logo-light.svg',
        });
    });

    test('serves the app shell for root menu URLs with query parameters', async () => {
        const response = await app.request(
            'https://example.com/?bookId=book-1',
            undefined,
            createTestEnv(),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ pathname: '/index.html' });
    });
});
