import {Receiver} from "@streammachine/nodejs-driver";

/**
 * @todo: Where should these come from?
 */
const CONFIG = require("../../assets/config-dev.json");
const CREDENTIALS = require("../../assets/credentials-dev.json");

async function startReceiver() {
    const receiver = new Receiver({
        ...CREDENTIALS.IN,
        authUrl: CONFIG.authUrl,
        schemaUrl: CONFIG.schemaUrl,
    });

    receiver.on("event", (event) => {
        console.log("Receiver", `Event received: ${event.abTests}`);
    });

    receiver.on("error", (error) => {
        console.log("Receiver", error.message);
    });

    try {
        await receiver.connect();
    } catch (error) {
        console.log("Connect failed", error);
    }
}

startReceiver();
