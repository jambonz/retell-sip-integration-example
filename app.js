const express = require('express');
const app = express();
const {createServer} = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const server = createServer(app);
const makeService = createEndpoint({server});
const webhooks = require('./lib/webhooks');
const logger = require('pino')({level: process.env.LOGLEVEL || 'info'});
const port = process.env.WS_PORT || process.env.PORT || 3000;

app.locals = {
  ...app.locals,
  logger
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/', webhooks);

// Set up environment routes
app.use('/', require('./lib/env-vars'));

require('./lib/routes')({logger, makeService});

server.listen(port, () => {
  logger.info(`jambonz websocket server listening at http://localhost:${port}`);
});
