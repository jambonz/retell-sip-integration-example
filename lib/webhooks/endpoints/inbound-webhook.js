const router = require('express').Router();

router.post('/', (req, res) => {
  const {logger} = req.app.locals;
  const payload = req.body;
  logger.info({payload}, 'inbound webhook');
  res.json({
    call_inbound: {
      dynamic_variables: {
        user_name: 'John Doe',
        user_email: 'john@example.com'
      },
      metadata: {
        random_id: '12345'
      }
    }
  });
});

module.exports = router;
