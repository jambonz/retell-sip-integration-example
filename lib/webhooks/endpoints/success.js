const router = require('express').Router();

router.get('/', (req, res) => {
  const {logger} = req.app.locals;
  logger.info(req.headers);
  const text = `<h1>Congratulations</h1> You have sucessfully deployed the application,<br>
  Use the following URLs setting up the jambonz application:<br><br>
  Calling  webook : <b>wss://${req.headers.host}/retell</b><br><br>
  Call status webhook : <b>wss://${req.headers.host}/retell</b> `;
  res.send(text);
});

module.exports = router;
