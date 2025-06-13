const {getE164} = require('../../lib/utils');

const sessions = {};
const service = ({logger, makeService}) => {
  const svc = makeService({path: '/socket'});

  svc.on('session:new', async(session) => {
    sessions[session.call_sid] = session;

    session.locals = {logger: logger.child({call_sid: session.call_sid})};
    let {from, to} = session;
    logger.info(`new ${session.direction} call: ${session.call_sid}`);

    /* Setup the env vars from the webhook or from process.env if not sent */
    const PSTN_TRUNK_NAME = session.env_vars.PSTN_TRUNK_NAME || process.env.PSTN_TRUNK_NAME;
    const RETELL_SIP_CLIENT_USERNAME = session.env_vars.RETELL_SIP_CLIENT_USERNAME || process.env.RETELL_SIP_CLIENT_USERNAME;
    const RETELL_TRUNK_NAME = session.env_vars.RETELL_TRUNK_NAME || process.env.RETELL_TRUNK_NAME;
    const DEFAULT_COUNTRY = session.env_vars.DEFAULT_COUNTRY || process.env.DEFAULT_COUNTRY || false;
    const OVERRIDE_FROM_USER =  session.env_vars.OVERRIDE_FROM_USER || process.env.OVERRIDE_FROM_USER | false;

    /* Send ping to keep alive websocket as some platforms timeout, 25sec as 30sec timeout is not uncommon */
    session.locals.keepAlive = setInterval(() => {
      session.ws.ping();
    }, 25000);

    /* Determine Call direction */
    let outboundFromRetell = false;
    if (session.direction === 'inbound' &&
      PSTN_TRUNK_NAME && RETELL_SIP_CLIENT_USERNAME &&
      session.sip.headers['X-Authenticated-User']) {

      /* check if the call is coming from Retell; i.e. using the sip credential we provisioned there */
      const username = session.sip.headers['X-Authenticated-User'].split('@')[0];
      if (username === RETELL_SIP_CLIENT_USERNAME) {
        logger.info(`call ${session.call_sid} is coming from Retell`);
        outboundFromRetell = true;
      }
    }

    session
      .on('/refer', onRefer.bind(null, session))
      .on('close', onClose.bind(null, session))
      .on('error', onError.bind(null, session))
      .on('/dialAction', onDialAction.bind(null, session))
      .on('/referComplete', onReferComplete.bind(null, session));

    try {
      let target;
      const headers = {};
      if (outboundFromRetell) {
        /* call is coming from Retell, so we will forward it to the original dialed number on the PSTN trunk */
        target = [
          {
            type: 'phone',
            number: to,
            trunk: PSTN_TRUNK_NAME
          }
        ];
        /* Workaround for SIPGATE, put User ID as from and CLI in header */
        if (OVERRIDE_FROM_USER) {
          from = OVERRIDE_FROM_USER;
        }
      }
      else { //Call is from Carrier send it to retell
        /* https://docs.retellai.com/deploy/custom-telephony#method-1-elastic-sip-trunking-recommended */

        /**
         * Note: below we are forwarding the incoming call to Retell using the same dialed number.
         * This presumes you have added this number to your Retell account.
         * If you added a different number, you can change the `to` variable.
         */
        // If default country code is set then ensure to is in e.164 format
        const dest = DEFAULT_COUNTRY ? await getE164(to, DEFAULT_COUNTRY, logger) : to;
        target = [
          {
            type: 'phone',
            number: dest,
            trunk: RETELL_TRUNK_NAME
          }
        ];
      }
      // Now that we have the destination target, send the dial command to the session.
      session
        .dial({
          callerId: from,
          answerOnBridge: true,
          anchorMedia: true,
          referHook: '/refer',
          actionHook: '/dialAction',
          target,
          headers
        })
        .hangup()
        .send();
    } catch (err) {
      session.locals.logger.info({err}, `Error to responding to incoming call: ${session.call_sid}`);
      session.close();
    }
  });
};

/* When the remote end sends a refer pass it on to the other leg */
const onRefer = (session, evt) => {
  const {logger} = session.locals;
  const {refer_details} = evt;
  logger.info({refer_details}, `session ${session.call_sid} received refer`);

  session
    .sip_refer({
      referTo: refer_details.refer_to_user,
      referredBy: evt.to,
      actionHook: '/referComplete'
    })
    .reply();
};

const onClose = (session, code, reason) => {
  const {logger} = session.locals;
  clearInterval(session.locals.keepAlive); // remove keep alive
  logger.info({code, reason}, `session ${session.call_sid} closed`);
};

const onError = (session, err) => {
  const {logger} = session.locals;
  logger.info({err}, `session ${session.call_sid} received error`);
};

const onDialAction = (session, evt) => {
  const {logger} = session.locals;
  if (evt.dial_call_status != 'completed') {
    logger.info(`outbound dial failed with ${evt.dial_call_status}, ${evt.dial_sip_status}`);
    session
      .sip_decline({status: evt.dial_sip_status})
      .reply();
  }
};

/* When the refer completes if we have an adulted call scenario hangup the original A leg */
const onReferComplete = (session, evt) => {
  const {logger} = session.locals;
  logger.info({evt}, 'referComplete');
  if (session.parent_call_sid) {
    logger.info(`Sending hangup to parent session ${session.parent_call_sid}`);
    const parentSession = sessions[session.parent_call_sid];
    parentSession
      .hangup()
      .send();
  } else {
    logger.debug('No parent session');
  }
};
module.exports = service;
