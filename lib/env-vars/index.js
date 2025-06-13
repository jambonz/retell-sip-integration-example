const router = require('express').Router();

router.use('/retell', require('./options-handler'));
module.exports = router;
