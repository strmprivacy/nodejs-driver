const streammachine = require('./streammachine')


const SCHEMAID = "clickstream";

/** create a dummy event.
 */
function create_event() {
    return {
        abTests: ["abc"],
        eventType: "button x clicked",
        customer: {id: "customer-id"},
        referrer: "https://www.streammachine.io",
        userAgent: "node-js",
        producerSessionId: "prodsesid",
        conversion: 1,
        url: "https://portal.streammachine.io/",
        strmMeta: {
            // the other fields are filled in by the Client
            consentLevels: [0, 1, 2],
        }
    }
}

function dummy_sender(sender) {
    setInterval(() => sender.send_event(create_event()), 500);
}

async function startup(config, handler, schemaId) {
    new streammachine.Sender(config, schemaId).init()
        .then(sender => handler(sender))
        .catch(error => console.error(error));
    await new Promise(r => setTimeout(r, 86400000));
}

startup({}, dummy_sender, SCHEMAID);
