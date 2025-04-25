const useDialSipEndpointMethod = Number(process.env.USE_DIAL_SIP_ENDPOINT_METHOD) || 0;
const assert = require('assert');
const {registerCall, getE164, validateCountryCode} = require('../../lib/utils');
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || false;
const OVERRIDE_FROM_USER = process.env.OVERRIDE_FROM_USER || false;
const REFER_METHOD = process.env.REFER_METHOD || 'REFER';

assert.ok(useDialSipEndpointMethod === 1 || process.env.RETELL_TRUNK_NAME,
  // eslint-disable-next-line max-len
  'RETELL_TRUNK_NAME env required when using elastic sip trunking method; it must contain the name of the jambonz BYOC trunk that connects to retell');

// IF a default country code has been set check its the right format,
if (DEFAULT_COUNTRY){
  validateCountryCode(DEFAULT_COUNTRY);
}

const service = ({logger, makeService}) => {
  const svc = makeService({path: '/retell'});

  svc.on('session:new', async(session) => {
    session.locals = {logger: logger.child({call_sid: session.call_sid})};
    let {from, to, direction, call_sid} = session;
    logger.info({session}, `new incoming call: ${session.call_sid}`);

    /* Send ping to keep alive websocket as some platforms timeout, 25sec as 30sec timeout is not uncommon */
    session.locals.keepAlive = setInterval(() => {
      session.ws.ping();
    }, 25000);

    let outboundFromRetell = false;
    if (session.direction === 'inbound' &&
      process.env.PSTN_TRUNK_NAME && process.env.RETELL_SIP_CLIENT_USERNAME &&
      session.sip.headers['X-Authenticated-User']) {

      /* check if the call is coming from Retell; i.e. using the sip credential we provisioned there */
      const username = session.sip.headers['X-Authenticated-User'].split('@')[0];
      if (username === process.env.RETELL_SIP_CLIENT_USERNAME) {
        logger.info(`call ${session.call_sid} is coming from Retell`);
        outboundFromRetell = true;
      }
    }
    session
      .on('/refer', onRefer.bind(null, session))
      .on('close', onClose.bind(null, session))
      .on('error', onError.bind(null, session))
      .on('/dialAction', onDialAction.bind(null, session));

    try {
      let target;
      let headers = {}
      if (outboundFromRetell) {
        /* call is coming from Retell, so we will forward it to the original dialed number */
        target = [
          {
            type: 'phone',
            number: to,
            trunk: process.env.PSTN_TRUNK_NAME
          }
        ];
        /* Workaround for SIPGATE, put User ID as from and CLI in header */
        if (OVERRIDE_FROM_USER) {
          //headers["P-Preferred-Identity"] = `${from}@SIPGATE_DOMAIN`;
          from = OVERRIDE_FROM_USER;
        }
      }
      else if (useDialSipEndpointMethod) {
        /* https://docs.retellai.com/make-calls/custom-telephony#method-2-dial-to-sip-endpoint */
        const retell_call_id = await registerCall(logger, {
          agent_id: process.env.RETELL_AGENT_ID,
          from,
          to,
          direction,
          call_sid,
          retell_llm_dynamic_variables: {
            /* https://docs.retellai.com/retell-llm/dynamic-variables#phone-calls-with-your-own-numbers-custom-twilio */
            user_name: 'John Doe',
            user_email: 'john@example.com'
          }
        });
        logger.info({retell_call_id}, 'Call registered');
        target = [
          {
            type: 'sip',
            sipUri: `sip:${retell_call_id}@5t4n6j0wnrl.sip.livekit.cloud`
          }
        ];
      }
      else {
        /* https://docs.retellai.com/make-calls/custom-telephony#method-1-elastic-sip-trunking-recommended */

        /**
         * Note: below we are forwarding the incoming call to Retell using the same dialed number.
         * This presumes you have added this number to your Retell account.
         * If you added a different number, you can change the `to` variable.
         */
        // If default country code is set then ensure to is in e.164 format 
        const dest = DEFAULT_COUNTRY ? await getE164(to, DEFAULT_COUNTRY) : to   
        target = [
          {
            type: 'phone',
            number: dest,
            trunk: process.env.RETELL_TRUNK_NAME
          }
        ];
      }

      session
        .dial({
          callerId: from,
          answerOnBridge: true,
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

const onRefer = (session, evt) => {
  const {logger} = session.locals;
  const {refer_details} = evt;
  logger.info({refer_details}, `session ${session.call_sid} received refer`);

  if (REFER_METHOD == 'DIAL'){
    session
    .dial({
      callerId: from,
      answerOnBridge: true,
      target : {
        type: 'phone',
        number: refer_details.refer_to_user,
        trunk: process.env.PSTN_TRUNK_NAME
      }
    })
    .reply();
  } else {
    session
    .sip_refer({
      referTo: refer_details.refer_to_user,
      referredBy: evt.to
    })
    .reply();
  }
  
};

const onClose = (session, code, reason) => {
  const {logger} = session.locals;
  clearInterval(session.locals.keepAlive); // remove keep alive
  logger.info({session, code, reason}, `session ${session.call_sid} closed`);
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
}

module.exports = service;
