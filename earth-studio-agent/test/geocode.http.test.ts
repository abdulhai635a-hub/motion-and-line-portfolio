/**
 * The online geocoder over a real HTTP connection.
 *
 * The public Nominatim service is not reachable from every build environment
 * (and hammering it from tests would be rude), so this serves a local endpoint
 * that answers in Nominatim's jsonv2 shape. It exercises the parts that a stub
 * `fetch` cannot: real sockets, real headers, real status codes and timeouts.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Geocoder, createNominatimProvider, offlineProvider } from '../src/geocode/index.ts';
import { planCameraPath } from '../src/agent.ts';
import { AgentError } from '../src/errors.ts';

const ROWS = [
  {
    name: 'Dhaka',
    display_name: 'Dhaka, Dhaka District, Dhaka Division, Bangladesh',
    lat: '23.7644025',
    lon: '90.389015',
    importance: 0.72,
    addresstype: 'city',
    category: 'place',
  },
];

let server: Server;
let endpoint: string;
let lastRequest: { url: string; userAgent: string | undefined } | undefined;
let mode: 'ok' | 'error' | 'garbage' | 'hang' = 'ok';

before(async () => {
  server = createServer((request, response) => {
    lastRequest = { url: request.url ?? '', userAgent: request.headers['user-agent'] };
    if (mode === 'hang') return; // never responds, to exercise the timeout
    if (mode === 'error') {
      response.writeHead(429, { 'Content-Type': 'text/plain' });
      response.end('slow down');
      return;
    }
    if (mode === 'garbage') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"not":"an array"}');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(ROWS));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  endpoint = `http://127.0.0.1:${port}/search`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('online geocoder over real HTTP', () => {
  test('resolves a place the built-in table does not know', async () => {
    mode = 'ok';
    const geocoder = new Geocoder({ providers: [offlineProvider, createNominatimProvider({ endpoint })] });
    const place = await geocoder.resolve('Dhaka');
    assert.equal(place.provider, 'nominatim');
    assert.equal(place.name, 'Dhaka');
    assert.equal(place.kind, 'city');
    assert.ok(Math.abs(place.latitude - 23.7644) < 0.001);
    assert.ok(Math.abs(place.longitude - 90.389) < 0.001);
  });

  test('sends the query and a descriptive User-Agent', async () => {
    mode = 'ok';
    await createNominatimProvider({ endpoint }).lookup('Dhaka');
    assert.match(lastRequest?.url ?? '', /q=Dhaka/);
    assert.match(lastRequest?.url ?? '', /format=jsonv2/);
    assert.match(lastRequest?.userAgent ?? '', /earth-studio-agent/);
  });

  test('a full plan can be built from an online lookup', async () => {
    mode = 'ok';
    const geocoder = new Geocoder({ providers: [offlineProvider, createNominatimProvider({ endpoint })] });
    const { path } = await planCameraPath('fly to Dhaka and zoom in close', { geocoder });
    assert.equal(path.keyframes.length, 2);
    assert.equal(path.keyframes.at(-1)?.camera.altitude, 1_500);
    assert.ok(Math.abs((path.keyframes.at(-1)?.camera.latitude ?? 0) - 23.7644) < 0.001);
  });

  test('the built-in table still wins for places it knows', async () => {
    mode = 'ok';
    lastRequest = undefined;
    const geocoder = new Geocoder({ providers: [offlineProvider, createNominatimProvider({ endpoint })] });
    assert.equal((await geocoder.resolve('Tokyo')).provider, 'gazetteer');
    assert.equal(lastRequest, undefined, 'the network should not be touched for a known place');
  });

  test('an HTTP error becomes an explained failure, not a stack trace', async () => {
    mode = 'error';
    await assert.rejects(() => createNominatimProvider({ endpoint }).lookup('Dhaka'), (error: unknown) => {
      assert.ok(error instanceof AgentError);
      assert.equal(error.code, 'GEOCODER_UNAVAILABLE');
      assert.match(error.message, /429/);
      return true;
    });
  });

  test('an unexpected response body yields no candidates rather than crashing', async () => {
    mode = 'garbage';
    assert.deepEqual(await createNominatimProvider({ endpoint }).lookup('Dhaka'), []);
  });

  test('a hanging service is abandoned at the timeout', async () => {
    mode = 'hang';
    await assert.rejects(
      () => createNominatimProvider({ endpoint, timeoutMs: 250 }).lookup('Dhaka'),
      (error: unknown) => {
        assert.ok(error instanceof AgentError);
        assert.equal(error.code, 'GEOCODER_UNAVAILABLE');
        return true;
      },
    );
    mode = 'ok';
  });

  test('a failing online provider does not stop the built-in table answering', async () => {
    mode = 'error';
    const geocoder = new Geocoder({ providers: [createNominatimProvider({ endpoint }), offlineProvider] });
    assert.equal((await geocoder.resolve('Tokyo')).provider, 'gazetteer');
    mode = 'ok';
  });
});
