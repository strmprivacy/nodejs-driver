const streammachine = require('./streammachine')


function messageHandler(message){
    console.log(message);
}
/**
 * Start up the websocket receiver.
 *
 * Receives and decodes Avro binary.
 * @param streamnr: absent=fully encrypted stream (IN), integer= OUT[streamnr] decoded stream
 * @returns {Promise<void>} ignored.
 */
async function startup(config, callback, streamnr) {
    new streammachine.WsReceiver(config, callback).init(streamnr)
        .then(_ => console.log("client started"))
        .catch(error => console.error(error));
    await new Promise(r => setTimeout(r, 86400000));
}


// retrieve the consent-level [1] stream
startup({}, messageHandler, "1");
