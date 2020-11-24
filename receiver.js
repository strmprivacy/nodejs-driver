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


let dev_config = {
        gatewayUrl: "https://in.dev.strm.services/event",
        authUrl: "https://auth.dev.strm.services",
        egressUrl: "wss://out.dev.strm.services",
        schemaUrl: "https://out.dev.strm.services",

    credentialsFile: "credentials-dev.json"
}

let prod_config = {
    credentialsFile: "credentials-prod.json"
}
// retrieve the consent-level [1] stream
startup(prod_config, messageHandler, "1") ;
