const router = require('express').Router();

router.use('/socket', require('./options-handler'));
module.exports = router;
