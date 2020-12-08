import { Type } from "avsc";
import * as fs from "fs";
import { ClientStreamEvent, Sender } from "@streammachine/nodejs-driver";

/**
 * @todo: Where should these come from?
 */
const CONFIG = require("../../assets/config-dev.json");
const CREDENTIALS = require("../../assets/credentials-dev.json");
const SCHEMA_ID = "clickstream";
const SCHEMA = JSON.parse(fs.readFileSync("../assets/clickstream.avsc", "utf-8"));

async function startSender() {
  const sender = new Sender({
    ...CREDENTIALS.IN,
    authUrl: CONFIG.authUrl,
    apiUrl: CONFIG.gatewayUrl,
    schemaId: SCHEMA_ID,
    type: Type.forSchema(SCHEMA),
  });

  // Make sure to listen for error events, otherwise Node does not handle the error events (they're escalated)
  sender.on("error", (error) => {
    console.log("Sender", error.message);
  });

  try {
    await sender.connect();

    await sender.send(EVENT);
    await sender.send(EVENT);
    await sender.send(EVENT);

    sender.disconnect();
  } catch (error) {
    console.log("Connect failed", error);
  }
}

interface MyStreamEvent extends ClientStreamEvent {
  abTests: string[];
  eventType: string;
  customer: { id: string };
  referrer: string;
  userAgent: string;
  producerSessionId: string;
  conversion: number;
  url: string;
}

const EVENT: MyStreamEvent = {
  abTests: ["abc"],
  eventType: "button x clicked",
  customer: { id: "customer-id" },
  referrer: "https://www.streammachine.io",
  userAgent: "node-js",
  producerSessionId: "prodsesid",
  conversion: 1,
  url: "https://portal.streammachine.io/",
  strmMeta: {
    // the other fields are filled in by the Client
    consentLevels: [0, 1, 2],
  },
};

startSender();
