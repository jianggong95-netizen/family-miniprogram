const path = require('path');
const fs = require('fs');
const fastify = require('fastify');
const config = require('./config');
const { ok } = require('./utils');

// 确保图片目录存在（@fastify/static 要求 root 已存在）
fs.mkdirSync(config.imagesDir, { recursive: true });

async function build() {
  const app = fastify({ logger: true });

  // 图片静态访问：GET /uploads/*
  await app.register(require('@fastify/static'), {
    root: config.imagesDir,
    prefix: '/uploads/',
  });

  // multipart 上传支持
  await app.register(require('@fastify/multipart'), {
    limits: { fileSize: 10 * 1024 * 1024, files: 9 },
  });

  // 健康检查
  app.get('/api/health', async () => ok({ status: 'up', devMode: config.devMode }));

  // 业务路由
  app.register(require('./routes/auth'));
  app.register(require('./routes/family'));
  app.register(require('./routes/clothes'));
  app.register(require('./routes/stock'));
  app.register(require('./routes/stats'));
  app.register(require('./routes/report'));
  app.register(require('./routes/dicts'));

  // 兜底 404
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ code: 404, data: null, message: '接口不存在' });
  });

  return app;
}

if (require.main === module) {
  build().then((app) => {
    app.listen({ port: config.port, host: '0.0.0.0' }, (err) => {
      if (err) {
        app.log.error(err);
        process.exit(1);
      }
      app.log.info(`家庭衣橱后端已启动: http://0.0.0.0:${config.port} (devMode=${config.devMode})`);
    });
  }).catch((e) => {
    console.error('启动失败:', e);
    process.exit(1);
  });
}

module.exports = { build };
