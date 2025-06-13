const router = require('express').Router();

const path = require('path');
const { validateAppConfig, getAppConfig } = require('@jambonz/node-client-ws');
const appJsonPath = path.join(__dirname, '../../app_env.json');
const appJson = require(appJsonPath);

router.options('/', (req, res) => {
  const {logger} = req.app.locals;
  logger.info(`OPTIONS request received for path: ${req.baseUrl}`);

  // First validate the app.json using SDK's validation
  const validationResult = validateAppConfig(appJson);
  if (!validationResult.isValid) {
    logger.error({ errors: validationResult.errors }, 'app.json validation failed');
    return res.status(500).json({
      error: 'Invalid app.json configuration',
      details: validationResult.errors
    });
  }

  // Get the appropriate configuration using SDK's getAppConfig
  const result = getAppConfig({ urlPath: req.baseUrl, appJsonPath });
  if (!result.success) {
    logger.error(result.error);
    return res.status(500).json({ error: result.error });
  }

  logger.debug({ config: result.config }, 'Returning configuration');
  res.json(result.config);
});

module.exports = router;
