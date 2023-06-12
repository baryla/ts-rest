import { initContract } from '@ts-rest/core';
import { initServer } from './ts-rest-fastify';
import { z } from 'zod';
import fastify from 'fastify';
import * as supertest from 'supertest';

const c = initContract();

const contract = c.router({
  test: {
    method: 'GET',
    path: '/test',
    responses: {
      200: z.object({
        foo: z.string(),
      }),
    },
  },
  ping: {
    method: 'POST',
    path: '/ping',
    body: z.object({
      ping: z.string(),
    }),
    responses: {
      200: z.object({
        pong: z.string(),
      }),
    },
  },
  testPathParams: {
    method: 'GET',
    path: '/test/:id',
    pathParams: z.object({
      id: z.string(),
    }),
    responses: {
      200: z.object({
        id: z.string(),
      }),
    },
  },
  returnsTheWrongData: {
    method: 'GET',
    path: '/wrong',
    responses: {
      200: z.object({
        foo: z.string(),
      }),
    },
  },
});

jest.setTimeout(30000);

describe('ts-rest-fastify', () => {
  const s = initServer();

  const router = s.router(contract, {
    test: async () => {
      return {
        status: 200,
        body: {
          foo: 'bar',
        },
      };
    },
    ping: async ({ body }) => {
      return {
        status: 200,
        body: {
          pong: body.ping,
        },
      };
    },
    testPathParams: async ({ params }) => {
      return {
        status: 200,
        body: {
          id: params.id,
        },
      };
    },
    returnsTheWrongData: async () => {
      return {
        status: 200,
        body: {
          foo: 'bar',
          bar: 'foo', // this is extra
        },
      };
    },
  });

  it('should instantiate fastify routes', async () => {
    const app = fastify({ logger: false });

    s.registerRouter(contract, router, app, {
      logInitialization: false,
    });

    await app.ready();

    const response = await supertest(app.server).get('/test');

    expect(response.statusCode).toEqual(200);
    expect(response.body).toEqual({ foo: 'bar' });
  });

  it('should instantiate fastify routes using plugin instance', async () => {
    const app = fastify({ logger: false });

    app.register(s.plugin(router));

    await app.ready();

    const response = await supertest(app.server).get('/test');

    expect(response.statusCode).toEqual(200);
    expect(response.body).toEqual({ foo: 'bar' });
  });

  it('should allow for options when using plugin instance', async () => {
    const app = fastify({ logger: false });

    app.register(s.plugin(router), {
      responseValidation: true,
    });

    await app.ready();

    const response = await supertest(app.server).get('/wrong');

    expect(response.statusCode).toEqual(200);
    expect(response.body).toEqual({ foo: 'bar' });
  });

  it('should parse body correctly', async () => {
    const app = fastify({ logger: false });

    s.registerRouter(contract, router, app, {
      logInitialization: false,
    });

    await app.ready();

    const response = await supertest(app.server)
      .post('/ping')
      .send({ ping: 'foo' });

    expect(response.statusCode).toEqual(200);
    expect(response.body).toEqual({ pong: 'foo' });
  });

  it("should throw error if body doesn't match", async () => {
    const app = fastify({ logger: false });

    s.registerRouter(contract, router, app, {
      logInitialization: false,
    });

    await app.ready();

    const response = await supertest(app.server).post('/ping').send({});

    expect(response.statusCode).toEqual(400);
    expect(response.body).toEqual({
      bodyErrors: {
        issues: [
          {
            code: 'invalid_type',
            expected: 'string',
            message: 'Required',
            path: ['ping'],
            received: 'undefined',
          },
        ],
        name: 'ZodError',
      },
      headerErrors: null,
      pathParameterErrors: null,
      queryParameterErrors: null,
    });
  });

  it("should allow for custom error handler if body doesn't match", async () => {
    const app = fastify({ logger: false });

    s.registerRouter(contract, router, app, {
      logInitialization: false,
      requestValidationErrorHandler: (err, request, reply) => {
        return reply.status(500).send({
          numberOfBodyErrors: err.body?.issues.length,
        });
      },
    });

    await app.ready();

    const response = await supertest(app.server).post('/ping').send({});

    expect(response.statusCode).toEqual(500);
    expect(response.body).toEqual({
      numberOfBodyErrors: 1,
    });
  });

  it('should parse path params correctly', async () => {
    const app = fastify({ logger: false });

    s.registerRouter(contract, router, app, {
      logInitialization: false,
    });

    await app.ready();

    const response = await supertest(app.server).get('/test/foo');

    expect(response.statusCode).toEqual(200);
    expect(response.body).toEqual({ id: 'foo' });
  });

  it('options.responseValidation true should remove extra properties', async () => {
    const app = fastify({ logger: false });

    s.registerRouter(contract, router, app, {
      logInitialization: false,
      responseValidation: true,
    });

    await app.ready();

    const response = await supertest(app.server).get('/wrong');

    expect(response.statusCode).toEqual(200);
    expect(response.body).toEqual({ foo: 'bar' });
  });

  it('options.responseValidation false should not remove extra properties', async () => {
    const app = fastify({ logger: false });

    s.registerRouter(contract, router, app, {
      logInitialization: false,
      responseValidation: false,
    });

    await app.ready();

    const response = await supertest(app.server).get('/wrong');

    expect(response.statusCode).toEqual(200);
    expect(response.body).toEqual({ foo: 'bar', bar: 'foo' });
  });

  it('prefixed contract should work with fastify', async () => {
    const postsContractNested = c.router(
      {
        getPost: {
          path: '/:postId',
          method: 'GET',
          responses: { 200: c.response<{ id: string }>() },
        },
      },
      { pathPrefix: '/posts' }
    );
    const postsContract = c.router(
      {
        posts: postsContractNested,
      },
      { pathPrefix: '/v1' }
    );
    const router = s.router(postsContract, {
      posts: {
        getPost: async ({ params }) => {
          return { status: 200, body: { id: params.postId } };
        },
      },
    });
    const app = fastify();
    s.registerRouter(postsContract, router, app);

    await app.ready();

    const response = await supertest(app.server).get('/v1/posts/10');

    expect(response.statusCode).toEqual(200);
    expect(response.body).toEqual({ id: '10' });
  });

  it('should handle non-json response types from contract', async () => {
    const c = initContract();

    const nonJsonContract = c.router({
      postIndex: {
        method: 'POST',
        path: `/index.html`,
        body: z.object({
          echoHtml: z.string(),
        }),
        responses: {
          200: c.otherResponse({
            contentType: 'text/html',
            body: z.string().regex(/^<([a-z][a-z0-9]*)\b[^>]*>(.*?)<\/\1>$/im),
          }),
        },
      },
      getRobots: {
        method: 'GET',
        path: `/robots.txt`,
        responses: {
          200: c.otherResponse({
            contentType: 'text/plain',
            body: c.type<string>(),
          }),
        },
      },
      getCss: {
        method: 'GET',
        path: '/style.css',
        responses: {
          200: c.otherResponse({
            contentType: 'text/css',
            body: c.type<string>(),
          }),
        },
      },
    });

    const nonJsonRouter = s.router(nonJsonContract, {
      postIndex: async ({ body: { echoHtml } }) => {
        return {
          status: 200,
          body: echoHtml,
        };
      },
      getRobots: async () => {
        return {
          status: 200,
          body: 'User-agent: * Disallow: /',
        };
      },
      getCss: async () => {
        return {
          status: 200,
          body: 'body { color: red; }',
        };
      },
    });

    const app = fastify({ logger: false });

    s.registerRouter(nonJsonContract, nonJsonRouter, app, {
      logInitialization: false,
      responseValidation: true,
    });

    app.setErrorHandler((err, request, reply) => {
      reply.status(500).send(err.message);
    });

    await app.ready();

    const responseHtml = await supertest(app.server).post('/index.html').send({
      echoHtml: '<h1>hello world</h1>',
    });
    expect(responseHtml.status).toEqual(200);
    expect(responseHtml.text).toEqual('<h1>hello world</h1>');
    expect(responseHtml.header['content-type']).toEqual('text/html');

    const responseHtmlFail = await supertest(app.server)
      .post('/index.html')
      .send({
        echoHtml: 'hello world',
      });
    expect(responseHtmlFail.status).toEqual(500);
    expect(responseHtmlFail.text).toEqual('Response validation failed');
    expect(responseHtmlFail.header['content-type']).toEqual(
      'text/plain; charset=utf-8'
    );

    const responseTextPlain = await supertest(app.server).get('/robots.txt');
    expect(responseTextPlain.status).toEqual(200);
    expect(responseTextPlain.text).toEqual('User-agent: * Disallow: /');
    expect(responseTextPlain.header['content-type']).toEqual('text/plain');

    const responseCss = await supertest(app.server).get('/style.css');
    expect(responseCss.status).toEqual(200);
    expect(responseCss.text).toEqual('body { color: red; }');
    expect(responseCss.header['content-type']).toEqual('text/css');
  });

  it('should be able to use a hook on a single endpoint', async () => {
    const contract = c.router({
      getMe: {
        method: 'GET',
        path: '/me',
        responses: { 200: z.boolean() },
      },
    });

    const router = s.router(contract, {
      getMe: {
        hooks: {
          preValidation: async (request, reply) => {
            reply.status(401).send({ message: 'Unauthorized' });
          },
        },
        handler() {
          return { status: 200, body: true };
        },
      },
    });

    const app = fastify();
    app.register(s.plugin(router));

    await app.ready();

    const response = await supertest(app.server).get('/me');

    expect(response.statusCode).toEqual(401);
    expect(response.body).toEqual({ message: 'Unauthorized' });
  });

  it('should be able to use multiple hooks on a single endpoint', async () => {
    let calledTimes = 0;
    const contract = c.router({
      getMe: {
        method: 'GET',
        path: '/me',
        responses: { 200: z.boolean() },
      },
    });

    const router = s.router(contract, {
      getMe: {
        hooks: {
          preValidation: async () => {
            calledTimes += 1;
          },
          onRequest: [
            async () => {
              calledTimes += 1;
            },
            (_, __, done) => {
              calledTimes += 1;
              done();
            },
          ],
        },
        handler() {
          return { status: 200, body: true };
        },
      },
    });

    const app = fastify();
    app.register(s.plugin(router));

    await app.ready();

    const response = await supertest(app.server).get('/me');

    expect(response.statusCode).toEqual(200);
    expect(response.body).toBeTruthy();
    expect(calledTimes).toEqual(3);
  });

  it('should be able to use a global hook', async () => {
    const contract = c.router({
      getMe: {
        method: 'GET',
        path: '/me',
        responses: { 200: z.boolean() },
      },
    });

    const router = s.router(contract, {
      getMe: {
        handler() {
          return { status: 200, body: true };
        },
      },
    });

    const app = fastify();
    app.register(s.plugin(router), {
      hooks: {
        onRequest: async (request, reply) => {
          reply.status(401).send({ message: 'Unauthorized' });
        },
      },
    });

    await app.ready();

    const response = await supertest(app.server).get('/me');

    expect(response.statusCode).toEqual(401);
    expect(response.body).toEqual({ message: 'Unauthorized' });
  });

  it('should be able to combine global hooks and route hooks', async () => {
    let calledTimes = 0;
    const contract = c.router({
      getMe: {
        method: 'GET',
        path: '/me',
        responses: { 200: z.boolean() },
      },
    });

    const router = s.router(contract, {
      getMe: {
        hooks: {
          preValidation: async () => {
            calledTimes += 1;
          },
        },
        handler() {
          return { status: 200, body: true };
        },
      },
    });

    const app = fastify();
    app.register(s.plugin(router), {
      hooks: {
        onRequest: async () => {
          calledTimes += 1;
        },
        preValidation: async () => {
          calledTimes += 1;
        },
      },
    });

    await app.ready();

    const response = await supertest(app.server).get('/me');

    expect(response.statusCode).toEqual(200);
    expect(response.body).toBeTruthy();
    expect(calledTimes).toEqual(3);
  });
});
