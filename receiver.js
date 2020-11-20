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
async function startup(streamnr) {
    new streammachine.WsReceiver(messageHandler).init(streamnr)
        .then(client => {
            console.log("client started")
            client.connect_ws();
        })
        .catch(error => console.error(error));
    await new Promise(r => setTimeout(r, 86400000));
}

startup();
