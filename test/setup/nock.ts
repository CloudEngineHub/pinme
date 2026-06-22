import { afterAll, afterEach, beforeAll } from 'vitest';
import nock from 'nock';

beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect((host) => host.startsWith('127.0.0.1'));
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
});
