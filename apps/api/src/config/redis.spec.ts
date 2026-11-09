import { redisOptionsFromUrl } from './redis';

describe('redisOptionsFromUrl', () => {
  it('parses host and default port', () => {
    expect(redisOptionsFromUrl('redis://localhost')).toEqual({ host: 'localhost', port: 6379 });
  });

  it('parses credentials, database index and TLS', () => {
    expect(redisOptionsFromUrl('rediss://user:p%40ss@cache.example.com:6380/2')).toEqual({
      host: 'cache.example.com',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 2,
      tls: {},
    });
  });
});
